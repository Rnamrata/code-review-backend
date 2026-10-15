import { describe, it, expect } from 'vitest';
import { Finding } from '../models/finding';
import { mergeFindings } from './findingsMerger.service';

// Builds a finding with sensible defaults; override only what a test cares about.
const finding = (overrides: Partial<Finding> = {}): Finding => ({
  file: 'app.py',
  line: 1,
  message: 'a problem',
  severity: 'low',
  category: 'bug',
  source: 'ruff',
  ...overrides
});

describe('mergeFindings', () => {
  describe('basics', () => {
    it('returns an empty list for no input', () => {
      expect(mergeFindings([])).toEqual([]);
    });

    it('returns an empty list when every analyzer found nothing', () => {
      expect(mergeFindings([[], []])).toEqual([]);
    });

    it('passes a single finding through unchanged', () => {
      const only = finding({ message: 'only one' });
      expect(mergeFindings([[only]])).toEqual([only]);
    });

    it('does not modify the findings it is given', () => {
      const linter = Object.freeze(finding({ severity: 'low', source: 'ruff' }));
      const llm = Object.freeze(
        finding({ severity: 'high', source: 'llm', suggestion: 'use X' })
      );

      const result = mergeFindings([[linter], [llm]]);

      expect(result).toHaveLength(1);
      expect(linter.severity).toBe('low');
      expect(linter.suggestion).toBeUndefined();
    });
  });

  describe('findings from the same analyzer', () => {
    it('keeps two findings on the same line and category apart', () => {
      const result = mergeFindings([
        [
          finding({ line: 7, message: 'E402', category: 'maintainability' }),
          finding({ line: 7, message: 'F403', category: 'maintainability' })
        ]
      ]);

      expect(result.map((f) => f.message).sort()).toEqual(['E402', 'F403']);
    });

    it('does not merge findings that have no source at all', () => {
      const result = mergeFindings([
        [finding({ source: undefined, message: 'first' })],
        [finding({ source: undefined, message: 'second' })]
      ]);

      expect(result).toHaveLength(2);
    });
  });

  describe('the same issue found by different analyzers', () => {
    it('merges a linter finding and an LLM finding on the same line and category', () => {
      const result = mergeFindings([
        [finding({ source: 'ruff', message: 'unsafe eval' })],
        [finding({ source: 'llm', message: 'eval can run attacker code' })]
      ]);

      expect(result).toHaveLength(1);
    });

    it('keeps the linter wording and source', () => {
      const [merged] = mergeFindings([
        [finding({ source: 'ruff', message: 'unsafe eval' })],
        [finding({ source: 'llm', message: 'eval can run attacker code' })]
      ]);

      expect(merged.message).toBe('unsafe eval');
      expect(merged.source).toBe('ruff');
    });

    it('keeps the linter wording even when the LLM list comes first', () => {
      const [merged] = mergeFindings([
        [finding({ source: 'llm', message: 'eval can run attacker code' })],
        [finding({ source: 'eslint', message: 'no-eval' })]
      ]);

      expect(merged.message).toBe('no-eval');
      expect(merged.source).toBe('eslint');
    });

    it('keeps the earlier wording when both analyzers are linters', () => {
      const [merged] = mergeFindings([
        [finding({ source: 'eslint', message: 'from eslint' })],
        [finding({ source: 'ruff', message: 'from ruff' })]
      ]);

      expect(merged.message).toBe('from eslint');
    });

    it.each([
      ['linter low, llm high', 'low', 'high', 'high'],
      ['linter high, llm low', 'high', 'low', 'high'],
      ['linter medium, llm critical', 'medium', 'critical', 'critical'],
      ['same severity', 'medium', 'medium', 'medium']
    ] as const)('takes the higher severity (%s)', (_label, linter, llm, expected) => {
      const [merged] = mergeFindings([
        [finding({ source: 'ruff', severity: linter })],
        [finding({ source: 'llm', severity: llm })]
      ]);

      expect(merged.severity).toBe(expected);
    });

    it("carries over the LLM's suggestion when the linter has none", () => {
      const [merged] = mergeFindings([
        [finding({ source: 'ruff' })],
        [finding({ source: 'llm', suggestion: 'use ast.literal_eval' })]
      ]);

      expect(merged.suggestion).toBe('use ast.literal_eval');
    });

    it("prefers the linter's own suggestion when both have one", () => {
      const [merged] = mergeFindings([
        [finding({ source: 'ruff', suggestion: 'from ruff' })],
        [finding({ source: 'llm', suggestion: 'from llm' })]
      ]);

      expect(merged.suggestion).toBe('from ruff');
    });

    it('merges when one side has no category', () => {
      const result = mergeFindings([
        [finding({ source: 'ruff', category: 'bug' })],
        [finding({ source: 'llm', category: undefined })]
      ]);

      expect(result).toHaveLength(1);
    });
  });

  describe('findings that look similar but are not the same issue', () => {
    it('keeps different categories on the same line apart', () => {
      const result = mergeFindings([
        [finding({ source: 'ruff', category: 'style' })],
        [finding({ source: 'llm', category: 'security' })]
      ]);

      expect(result).toHaveLength(2);
    });

    it('keeps different lines apart', () => {
      const result = mergeFindings([
        [finding({ source: 'ruff', line: 3 })],
        [finding({ source: 'llm', line: 4 })]
      ]);

      expect(result).toHaveLength(2);
    });

    it('keeps different files apart', () => {
      const result = mergeFindings([
        [finding({ source: 'ruff', file: 'a.py' })],
        [finding({ source: 'llm', file: 'b.py' })]
      ]);

      expect(result).toHaveLength(2);
    });
  });

  describe('one-to-one matching', () => {
    it('lets one linter finding absorb only one of several LLM findings', () => {
      const result = mergeFindings([
        [finding({ source: 'ruff', line: 3, message: 'lint' })],
        [
          finding({ source: 'llm', line: 3, message: 'llm-1' }),
          finding({ source: 'llm', line: 3, message: 'llm-2' }),
          finding({ source: 'llm', line: 3, message: 'llm-3' })
        ]
      ]);

      expect(result).toHaveLength(3);
      expect(result.filter((f) => f.source === 'ruff')).toHaveLength(1);
      expect(result.filter((f) => f.source === 'llm')).toHaveLength(2);
    });

    it('lets one LLM finding be absorbed by only one of several linter findings', () => {
      const result = mergeFindings([
        [
          finding({ source: 'ruff', line: 3, message: 'lint-1' }),
          finding({ source: 'ruff', line: 3, message: 'lint-2' }),
          finding({ source: 'ruff', line: 3, message: 'lint-3' })
        ],
        [finding({ source: 'llm', line: 3, message: 'llm' })]
      ]);

      expect(result).toHaveLength(3);
      expect(result.every((f) => f.source === 'ruff')).toBe(true);
    });
  });

  describe('ordering', () => {
    it('sorts by severity first', () => {
      const result = mergeFindings([
        [
          finding({ line: 1, severity: 'low' }),
          finding({ line: 2, severity: 'critical' }),
          finding({ line: 3, severity: 'medium' }),
          finding({ line: 4, severity: 'high' }),
          finding({ line: 5, severity: 'info' })
        ]
      ]);

      expect(result.map((f) => f.severity)).toEqual([
        'critical',
        'high',
        'medium',
        'low',
        'info'
      ]);
    });

    it('sorts by line within the same severity', () => {
      const result = mergeFindings([
        [
          finding({ line: 9, severity: 'low', message: 'nine' }),
          finding({ line: 2, severity: 'low', message: 'two' }),
          finding({ line: 5, severity: 'low', message: 'five' })
        ]
      ]);

      expect(result.map((f) => f.line)).toEqual([2, 5, 9]);
    });

    it('puts a higher severity on a later line before a lower severity on an earlier one', () => {
      const result = mergeFindings([
        [
          finding({ line: 1, severity: 'low' }),
          finding({ line: 90, severity: 'high' })
        ]
      ]);

      expect(result.map((f) => f.line)).toEqual([90, 1]);
    });
  });
});