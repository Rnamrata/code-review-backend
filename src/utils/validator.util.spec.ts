import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appConfig } from '../config/app.config';
import { Validator } from './validator.util';

const ONE_MB = 1024 * 1024;

// The validator reads its limits from appConfig. Pin them here so the tests do
// not depend on a developer's .env file, and restore them afterwards.
const original = {
  allowedExtensions: appConfig.allowedExtensions,
  maxFileSizeMB: appConfig.maxFileSizeMB
};

beforeEach(() => {
  appConfig.allowedExtensions = ['.py', '.js', '.ts'];
  appConfig.maxFileSizeMB = 1;
});

afterEach(() => {
  appConfig.allowedExtensions = original.allowedExtensions;
  appConfig.maxFileSizeMB = original.maxFileSizeMB;
});

describe('Validator.isValidFileExtension', () => {
  it.each(['app.py', 'index.js', 'main.ts'])('accepts %s', (filename) => {
    expect(Validator.isValidFileExtension(filename)).toBe(true);
  });

  it.each(['notes.txt', 'run.exe', 'archive.zip', 'Main.java'])(
    'rejects %s, which is not in the allowed list',
    (filename) => {
      expect(Validator.isValidFileExtension(filename)).toBe(false);
    }
  );

  it('ignores the case of the extension', () => {
    expect(Validator.isValidFileExtension('APP.PY')).toBe(true);
    expect(Validator.isValidFileExtension('Index.Js')).toBe(true);
  });

  it('uses only the last extension', () => {
    expect(Validator.isValidFileExtension('archive.tar.py')).toBe(true);
    expect(Validator.isValidFileExtension('app.py.txt')).toBe(false);
  });

  it('accepts a path as long as the file ends in an allowed extension', () => {
    expect(Validator.isValidFileExtension('src/utils/app.py')).toBe(true);
  });

  it('rejects a name with no extension', () => {
    expect(Validator.isValidFileExtension('Makefile')).toBe(false);
  });

  it('rejects a name that ends with a dot', () => {
    expect(Validator.isValidFileExtension('app.')).toBe(false);
  });

  it('treats a dotfile as having no extension', () => {
    expect(Validator.isValidFileExtension('.py')).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(Validator.isValidFileExtension('')).toBe(false);
  });

  it('follows the configured list, not a fixed one', () => {
    appConfig.allowedExtensions = ['.rb'];

    expect(Validator.isValidFileExtension('app.rb')).toBe(true);
    expect(Validator.isValidFileExtension('app.py')).toBe(false);
  });
});

describe('Validator.isValidFileSize', () => {
  it('rejects zero bytes', () => {
    expect(Validator.isValidFileSize(0)).toBe(false);
  });

  it('accepts one byte', () => {
    expect(Validator.isValidFileSize(1)).toBe(true);
  });

  it('accepts exactly the limit', () => {
    expect(Validator.isValidFileSize(ONE_MB)).toBe(true);
  });

  it('rejects one byte over the limit', () => {
    expect(Validator.isValidFileSize(ONE_MB + 1)).toBe(false);
  });

  it('rejects negative sizes', () => {
    expect(Validator.isValidFileSize(-1)).toBe(false);
  });

  it('rejects NaN', () => {
    expect(Validator.isValidFileSize(Number.NaN)).toBe(false);
  });

  it('follows the configured limit', () => {
    appConfig.maxFileSizeMB = 2;

    expect(Validator.isValidFileSize(2 * ONE_MB)).toBe(true);
    expect(Validator.isValidFileSize(2 * ONE_MB + 1)).toBe(false);
  });
});

describe('Validator.sanitizeFilename', () => {
  it('leaves letters, digits, dots, underscores and hyphens alone', () => {
    expect(Validator.sanitizeFilename('My_file-v2.final.py')).toBe('My_file-v2.final.py');
  });

  it('replaces spaces', () => {
    expect(Validator.sanitizeFilename('my file.py')).toBe('my_file.py');
  });

  it('replaces path separators, so a name cannot point at another directory', () => {
    expect(Validator.sanitizeFilename('src/utils/app.py')).toBe('src_utils_app.py');
    expect(Validator.sanitizeFilename('..\\secret.py')).toBe('.._secret.py');
  });

  it('neutralises a traversal attempt', () => {
    const result = Validator.sanitizeFilename('../../etc/passwd');
    expect(result).not.toContain('/');
    expect(result).toBe('.._.._etc_passwd');
  });

  it.each([
    ['a;rm -rf.py', 'a_rm_-rf.py'],
    ['a$(whoami).py', 'a__whoami_.py'],
    ['a|b&c.py', 'a_b_c.py'],
    ['quote"s\'.py', 'quote_s_.py']
  ])('replaces shell metacharacters in %s', (input, expected) => {
    expect(Validator.sanitizeFilename(input)).toBe(expected);
  });

  it('replaces each non-ASCII character with an underscore', () => {
    expect(Validator.sanitizeFilename('résumé.py')).toBe('r_sum_.py');
  });

  it('replaces control characters', () => {
    expect(Validator.sanitizeFilename('a\u0000b\n.py')).toBe('a_b_.py');
  });

  it('keeps a leading hyphen, so callers must pass it as --flag=value', () => {
    expect(Validator.sanitizeFilename('-rf.py')).toBe('-rf.py');
  });

  it('does not strip dots, so the extension must be validated first', () => {
    // ".." survives sanitising. It is only safe because isValidFileExtension
    // rejects it before the name is ever used in a path.
    expect(Validator.sanitizeFilename('..')).toBe('..');
    expect(Validator.isValidFileExtension('..')).toBe(false);
  });

  it('returns an empty string for an empty name', () => {
    expect(Validator.sanitizeFilename('')).toBe('');
  });
});