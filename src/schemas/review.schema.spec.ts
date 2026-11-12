import { afterEach, describe, expect, it } from 'vitest';
import { appConfig } from '../config/app.config';
import { parseReviewBody } from './review.schema';

const valid = { filename: 'app.py', language: 'python', code: 'x = 1\n' };
const ONE_MB = 1024 * 1024;
const original = { ...appConfig };

const problemOf = (input: unknown) => {
  const result = parseReviewBody(input);
  if (result.ok) throw new Error('expected the body to be rejected');
  return result.problem;
};

const INVALID_BODY = {
  error: 'Invalid request',
  message: 'Body must be JSON: { filename, language, code } (all strings)'
};

afterEach(() => {
  Object.assign(appConfig, original);
});

describe('a valid body', () => {
  it('is accepted', () => {
    expect(parseReviewBody(valid)).toEqual({ ok: true, body: valid });
  });

  it('keeps the code exactly as it was sent', () => {
    const code = '  x = 1\r\n\r\n';

    const result = parseReviewBody({ ...valid, code });

    expect(result.ok && result.body.code).toBe(code);
  });

  it('keeps the file name and the language as sent, for the controller to tidy up', () => {
    const result = parseReviewBody({ ...valid, filename: '  app.py', language: ' PY ' });

    // The leading spaces do not hide the extension; trailing ones would (see below).
    expect(result.ok && result.body).toMatchObject({ filename: '  app.py', language: ' PY ' });
  });

  it('drops fields it does not know', () => {
    const result = parseReviewBody({ ...valid, admin: true, extra: 'x' });

    expect(result).toEqual({ ok: true, body: valid });
  });

  it('accepts code that is only whitespace, because it is not empty', () => {
    expect(parseReviewBody({ ...valid, code: '   ' }).ok).toBe(true);
  });

  it.each(['.py', '.js', '.java', '.ts', '.jsx', '.tsx'])('accepts the extension %s', (extension) => {
    expect(parseReviewBody({ ...valid, filename: `file${extension}` }).ok).toBe(true);
  });

  it('accepts an extension in capitals', () => {
    expect(parseReviewBody({ ...valid, filename: 'APP.PY' }).ok).toBe(true);
  });
});

describe('a body of the wrong shape', () => {
  it.each([
    ['nothing at all', undefined],
    ['null', null],
    ['text', 'hello'],
    ['a number', 42],
    ['an array', []],
    ['an empty object', {}]
  ])('rejects %s', (_label, input) => {
    expect(problemOf(input)).toEqual(INVALID_BODY);
  });

  it.each(['filename', 'language', 'code'])('rejects a body without %s', (field) => {
    const { [field]: _removed, ...rest } = valid as Record<string, string>;

    expect(problemOf(rest)).toEqual(INVALID_BODY);
  });

  it.each([
    ['filename', 42],
    ['filename', null],
    ['language', 42],
    ['language', ['python']],
    ['code', 42],
    ['code', null],
    ['code', { text: 'x' }]
  ])('rejects %s given as %j', (field, value) => {
    expect(problemOf({ ...valid, [field]: value })).toEqual(INVALID_BODY);
  });

  it.each(['', '   ', '\n\t'])('rejects a blank file name (%j)', (filename) => {
    expect(problemOf({ ...valid, filename })).toEqual(INVALID_BODY);
  });

  it.each(['', '   '])('rejects a blank language (%j)', (language) => {
    expect(problemOf({ ...valid, language })).toEqual(INVALID_BODY);
  });
});

describe('the file extension', () => {
  it.each(['notes.txt', 'Makefile', 'app.', 'app.py.txt', '.py', 'run.exe', 'module.pyc'])(
    'rejects "%s"',
    (filename) => {
      expect(problemOf({ ...valid, filename }).error).toBe('Unsupported file type');
    }
  );

  it('rejects a file name whose extension is followed by a space', () => {
    expect(problemOf({ ...valid, filename: 'app.py ' }).error).toBe('Unsupported file type');
  });

  it('lists the allowed extensions in the message', () => {
    expect(problemOf({ ...valid, filename: 'a.txt' }).message).toBe(
      `Allowed extensions: ${appConfig.allowedExtensions.join(', ')}`
    );
  });

  it('follows the configured list', () => {
    appConfig.allowedExtensions = ['.rs'];

    expect(parseReviewBody({ ...valid, filename: 'main.rs' }).ok).toBe(true);
    expect(problemOf({ ...valid, filename: 'app.py' }).message).toBe('Allowed extensions: .rs');
  });
});

describe('the size of the code', () => {
  it('rejects empty code', () => {
    expect(problemOf({ ...valid, code: '' })).toEqual({
      error: 'Invalid code size',
      message: 'Code must be non-empty and within the configured size limits'
    });
  });

  it('accepts code of exactly the limit', () => {
    expect(parseReviewBody({ ...valid, code: 'x'.repeat(ONE_MB) }).ok).toBe(true);
  });

  it('rejects code one byte over the limit', () => {
    expect(problemOf({ ...valid, code: 'x'.repeat(ONE_MB + 1) }).error).toBe('Invalid code size');
  });

  it('counts bytes, not characters', () => {
    // 400,000 characters, but 1,200,000 bytes in UTF-8.
    expect(problemOf({ ...valid, code: '€'.repeat(400_000) }).error).toBe('Invalid code size');
  });

  it('follows MAX_FILE_SIZE_MB', () => {
    appConfig.maxFileSizeMB = 2;

    expect(parseReviewBody({ ...valid, code: 'x'.repeat(2 * ONE_MB) }).ok).toBe(true);
    expect(problemOf({ ...valid, code: 'x'.repeat(2 * ONE_MB + 1) }).error).toBe('Invalid code size');
  });
});

describe('which problem is reported first', () => {
  it('reports the shape before the extension', () => {
    expect(problemOf({ filename: 'notes.txt', language: 42, code: 'x' })).toEqual(INVALID_BODY);
  });

  it('reports a blank language before a bad extension', () => {
    expect(problemOf({ filename: 'notes.txt', language: '', code: 'x' })).toEqual(INVALID_BODY);
  });

  it('reports the extension before the size', () => {
    expect(problemOf({ filename: 'notes.txt', language: 'python', code: '' }).error).toBe('Unsupported file type');
  });

  it('reports the extension before code that is too large', () => {
    expect(problemOf({ filename: 'notes.txt', language: 'python', code: 'x'.repeat(ONE_MB + 1) }).error).toBe(
      'Unsupported file type'
    );
  });
});