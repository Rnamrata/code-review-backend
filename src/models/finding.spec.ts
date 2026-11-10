import { describe, expect, it } from 'vitest';
import { SEVERITY_ORDER, isSeverity } from './finding';

describe('isSeverity', () => {
  it.each(['critical', 'high', 'medium', 'low', 'info'])('accepts "%s"', (value) => {
    expect(isSeverity(value)).toBe(true);
  });

  it('accepts every severity the ordering knows about', () => {
    for (const severity of Object.keys(SEVERITY_ORDER)) {
      expect(isSeverity(severity)).toBe(true);
    }
  });

  it.each(['High', 'CRITICAL', 'urgent', 'warning', '', ' high'])('rejects "%s"', (value) => {
    expect(isSeverity(value)).toBe(false);
  });

  it.each([undefined, null, 42, true, {}, [], ['high']])('rejects the non-string %j', (value) => {
    expect(isSeverity(value)).toBe(false);
  });

  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'])(
    'rejects the inherited object key "%s"',
    (value) => {
      expect(isSeverity(value)).toBe(false);
    }
  );
});