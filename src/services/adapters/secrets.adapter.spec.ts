import { describe, it, expect } from 'vitest';
import { secretsAdapter } from './secrets.adapter';
import { ReviewRequest } from '../../models/review.model';

const request = (code: string, language = 'python'): ReviewRequest => ({
  filename: 'app.py',
  safeFilename: 'app.py',
  language,
  code
});

const scan = async (code: string, language?: string) => secretsAdapter.analyze(request(code, language));
const lines = async (code: string) => (await scan(code)).map((f) => f.line);

describe('secretsAdapter', () => {
  describe('which languages', () => {
    it('runs for the languages that have other checks', () => {
      for (const language of ['python', 'javascript', 'typescript', 'java']) {
        expect(secretsAdapter.supports(language)).toBe(true);
      }
    });

    it('leaves out languages with no other check, so their reviews still say nothing ran', () => {
      for (const language of ['cpp', 'csharp', 'cobol']) {
        expect(secretsAdapter.supports(language)).toBe(false);
      }
    });
  });

  describe("keys in a provider's own format", () => {
    it.each([
      ['Stripe live secret key', 'KEY = "sk_live_51HxQ2eZvKYlo2C0aBcD"'],
      ['AWS access key ID', 'aws = "AKIAIOSFODNN7EXAMPLE"'],
      ['GitHub token', `t = "ghp_${'a'.repeat(36)}"`],
      ['Slack token', 'hook = "xoxb-123456789012-abcdefghij"'],
      ['Google API key', `k = "AIza${'B'.repeat(35)}"`],
      ['OpenAI or Anthropic API key', 'client = Client("sk-proj-abcdefghijklmnopqrstuvwx")'],
      ['JSON Web Token', 'jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N"']
    ])('finds a %s', async (name, code) => {
      const [finding] = await scan(code);
      expect(finding.message).toBe(`Hard-coded ${name} in the code`);
      expect(finding).toMatchObject({ line: 1, severity: 'high', category: 'security', source: 'secrets' });
    });

    it('rates a live publishable key medium and says it is meant to be public', async () => {
      const [finding] = await scan("const API_KEY = 'pk_live_9f8e7d6c5b4a3210';", 'typescript');
      expect(finding.severity).toBe('medium');
      expect(finding.suggestion).toContain('meant for the browser');
    });

    it('finds a key even in a comment, since it is leaked all the same', async () => {
      expect(await lines('# old key: sk_live_51HxQ2eZvKYlo2C0aBcD')).toEqual([1]);
    });

    it('finds a private key only when key data follows its header', async () => {
      const key = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7';
      expect(await lines(`PEM = """-----BEGIN PRIVATE KEY-----\n${key}\n"""`)).toEqual([1]);
      expect(await lines(`pem = "-----BEGIN RSA PRIVATE KEY-----\\n${key}"`)).toEqual([1]);
      expect(await lines("# when your file has '-----BEGIN RSA PRIVATE KEY-----' and")).toEqual([]);
    });

    it('finds a password in a connection URL, but not the ones documentation uses', async () => {
      expect(await lines('DB = "postgres://admin:hunter2@db.internal:5432/shop"')).toEqual([1]);
      expect(await lines('DB = "postgres://user:pass@localhost:5432/shop"')).toEqual([]);
      expect(await lines('url = "github://org:repo@/precip/catalog.yml"')).toEqual([]);
      expect(await lines('# DB = "postgres://admin:hunter2@db.internal/shop"')).toEqual([]);
    });
  });

  describe('secrets known by their name', () => {
    it.each([
      ['Java', 'private static final String DB_PASSWORD = "Sup3rS3cret!";', 'DB_PASSWORD'],
      ['TypeScript', "const apiKey = 'a8f5f167f44f4964e6c998dee827110c';", 'apiKey'],
      ['a dictionary', "config = {'client_secret': 'q9Wv2-Lm4xZ'}", 'client_secret'],
      ['a keyword argument', "login(user='bob', password='s3cret!!')", 'password']
    ])('finds one in %s', async (_where, code, name) => {
      const [finding] = await scan(code);
      expect(finding.message).toBe(`Hard-coded secret: ${name} is set to a string in the code`);
    });

    it.each([
      ['an empty value', 'PASSWORD = ""'],
      ['a short value', 'token = "abc"'],
      ['a sentence', 'password_message = "Password is required"'],
      ['a placeholder', 'API_KEY = "your-api-key"'],
      ['an environment variable name', 'AWS_SECRET_ACCESS_KEY = "AWS_SECRET_ACCESS_KEY"'],
      ['a field name', '"refresh_token": "refreshToken",'],
      ['a URL', 'TOKEN_URL = "https://auth.example.com/token"'],
      ['a name where the kind comes first', 'TOKEN_COMMENT = "comment"'],
      ['an elided example', 'api_key = "sk-..."'],
      ['an interpolated value', 'print(f"TOKEN: \'{name}\'")'],
      ['a doc example', '>>> build_headers(token="hf_a1b2c3d4")'],
      ['a comment', '# password = "hunter22"'],
      ['a reference to configuration', 'password = os.environ["DB_PASSWORD"]']
    ])('ignores %s', async (_what, code) => {
      expect(await scan(code)).toEqual([]);
    });

    it('reads a name inside an escaped string correctly', async () => {
      const [finding] = await scan("code = 'import os\\nPASSWORD = \"admin123\"'");
      expect(finding.message).toContain('PASSWORD is set');
    });
  });

  describe('findings', () => {
    it('never repeats the secret itself', async () => {
      const findings = await scan('KEY = "sk_live_51HxQ2eZvKYlo2C0aBcD"\nDB_PASSWORD = "Sup3rS3cret!"');
      for (const f of findings) {
        expect(JSON.stringify(f)).not.toContain('51HxQ2eZvKYlo2C0aBcD');
        expect(JSON.stringify(f)).not.toContain('Sup3rS3cret');
      }
      expect(findings).toHaveLength(2);
    });

    it('reports one finding per line, on the line that holds the secret', async () => {
      expect(await lines('a = 1\nSUPPLIER_API_KEY = "sk_live_51HxQ2eZvKYlo2C0aBcD"\nb = 2')).toEqual([2]);
    });

    it('skips very long lines, such as minified code', async () => {
      expect(await scan(`x = "${'a'.repeat(2500)}"; KEY = "sk_live_51HxQ2eZvKYlo2C0aBcD"`)).toEqual([]);
    });

    it('stops when the review is cancelled', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(secretsAdapter.analyze(request('x = 1'), controller.signal)).rejects.toThrow();
    });
  });
});
