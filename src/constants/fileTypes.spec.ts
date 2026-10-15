import { describe, it, expect } from 'vitest';
import {
  FILE_EXTENSION_MAP,
  SUPPORTED_LANGUAGES,
  normalizeLanguage
} from './fileTypes';

describe('normalizeLanguage', () => {
  describe('canonical names', () => {
    it.each(Object.values(SUPPORTED_LANGUAGES))('keeps "%s" as it is', (language) => {
      expect(normalizeLanguage(language, 'file.txt')).toBe(language);
    });
  });

  describe('aliases', () => {
    it.each([
      ['js', 'javascript'],
      ['jsx', 'javascript'],
      ['ts', 'typescript'],
      ['tsx', 'typescript'],
      ['py', 'python'],
      ['c', 'cpp'],
      ['cs', 'csharp']
    ])('maps "%s" to "%s"', (alias, expected) => {
      expect(normalizeLanguage(alias, 'file.txt')).toBe(expected);
    });
  });

  describe('input cleanup', () => {
    it('ignores case', () => {
      expect(normalizeLanguage('JS', 'file.txt')).toBe('javascript');
      expect(normalizeLanguage('Python', 'file.txt')).toBe('python');
    });

    it('ignores surrounding whitespace', () => {
      expect(normalizeLanguage('  ts  ', 'file.txt')).toBe('typescript');
    });
  });

  describe('language versus file extension', () => {
    it('trusts the stated language over the extension', () => {
      expect(normalizeLanguage('python', 'script.js')).toBe('python');
    });

    it('falls back to the extension when the language is unknown', () => {
      expect(normalizeLanguage('cobol', 'app.py')).toBe('python');
    });

    it('falls back to the extension when the language is empty', () => {
      expect(normalizeLanguage('', 'component.tsx')).toBe('typescript');
    });

    it('reads the extension case-insensitively', () => {
      expect(normalizeLanguage('cobol', 'APP.PY')).toBe('python');
    });

    it('returns undefined when neither the language nor the extension is known', () => {
      expect(normalizeLanguage('cobol', 'notes.txt')).toBeUndefined();
    });

    it('returns undefined for an unknown language and a file with no extension', () => {
      expect(normalizeLanguage('cobol', 'Makefile')).toBeUndefined();
    });
  });

  describe('hostile input', () => {
    it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
      'does not treat "%s" as an alias',
      (name) => {
        expect(normalizeLanguage(name, 'notes.txt')).toBeUndefined();
        expect(normalizeLanguage(name, 'app.py')).toBe('python');
      }
    );
  });

  describe('consistency of the maps', () => {
    it('only maps extensions to supported languages', () => {
      const supported = Object.values(SUPPORTED_LANGUAGES) as string[];
      for (const language of Object.values(FILE_EXTENSION_MAP)) {
        expect(supported).toContain(language);
      }
    });

    it('lists every extension with a leading dot in lowercase', () => {
      for (const extension of Object.keys(FILE_EXTENSION_MAP)) {
        expect(extension).toMatch(/^\.[a-z]+$/);
      }
    });
  });
});