import { describe, it, expect } from 'vitest';
import { Finding } from '../models/finding';
import { buildSummary } from './reviewSummary.service';

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

describe('buildSummary', () => {
  describe('with no findings', () => {
    it('reports a total of zero', () => {
      expect(buildSummary([]).total).toBe(0);
    });

    it('still lists every severity, all at zero', () => {
      expect(buildSummary([]).bySeverity).toEqual({
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0
      });
    });

    it('has no sources and no categories', () => {
      const summary = buildSummary([]);
      expect(summary.bySource).toEqual({});
      expect(summary.byCategory).toEqual({});
    });
  });

  describe('total', () => {
    it('equals the number of findings', () => {
      const findings = [finding(), finding(), finding()];
      expect(buildSummary(findings).total).toBe(3);
    });

    it('counts findings that have no source or category', () => {
      const findings = [finding({ source: undefined, category: undefined })];
      expect(buildSummary(findings).total).toBe(1);
    });
  });

  describe('bySeverity', () => {
    it('counts each severity', () => {
      const summary = buildSummary([
        finding({ severity: 'critical' }),
        finding({ severity: 'high' }),
        finding({ severity: 'high' }),
        finding({ severity: 'medium' }),
        finding({ severity: 'low' }),
        finding({ severity: 'low' }),
        finding({ severity: 'low' }),
        finding({ severity: 'info' })
      ]);

      expect(summary.bySeverity).toEqual({
        critical: 1,
        high: 2,
        medium: 1,
        low: 3,
        info: 1
      });
    });

    it('adds up to the total', () => {
      const summary = buildSummary([
        finding({ severity: 'high' }),
        finding({ severity: 'low' }),
        finding({ severity: 'info' })
      ]);

      const sum = Object.values(summary.bySeverity).reduce((a, b) => a + b, 0);
      expect(sum).toBe(summary.total);
    });
  });

  describe('bySource', () => {
    it('counts findings per analyzer', () => {
      const summary = buildSummary([
        finding({ source: 'ruff' }),
        finding({ source: 'ruff' }),
        finding({ source: 'eslint' }),
        finding({ source: 'llm' })
      ]);

      expect(summary.bySource).toEqual({ ruff: 2, eslint: 1, llm: 1 });
    });

    it('only lists sources that actually produced findings', () => {
      const summary = buildSummary([finding({ source: 'ruff' })]);
      expect(Object.keys(summary.bySource)).toEqual(['ruff']);
    });

    it('does not count findings that have no source', () => {
      const summary = buildSummary([
        finding({ source: undefined }),
        finding({ source: 'ruff' })
      ]);

      expect(summary.bySource).toEqual({ ruff: 1 });
      expect(summary.total).toBe(2);
    });
  });

  describe('byCategory', () => {
    it('counts findings per category', () => {
      const summary = buildSummary([
        finding({ category: 'security' }),
        finding({ category: 'bug' }),
        finding({ category: 'bug' }),
        finding({ category: 'maintainability' })
      ]);

      expect(summary.byCategory).toEqual({ security: 1, bug: 2, maintainability: 1 });
    });

    it('groups findings with no category under "uncategorized"', () => {
      const summary = buildSummary([
        finding({ category: undefined }),
        finding({ category: undefined }),
        finding({ category: 'bug' })
      ]);

      expect(summary.byCategory).toEqual({ uncategorized: 2, bug: 1 });
    });
  });

  describe('independence', () => {
    it('does not carry counts over between calls', () => {
      buildSummary([finding({ severity: 'critical', source: 'ruff', category: 'bug' })]);
      const second = buildSummary([]);

      expect(second.total).toBe(0);
      expect(second.bySeverity.critical).toBe(0);
      expect(second.bySource).toEqual({});
      expect(second.byCategory).toEqual({});
    });

    it('does not modify the findings it is given', () => {
      const findings = Object.freeze([
        Object.freeze(finding({ severity: 'high' })),
        Object.freeze(finding({ severity: 'low' }))
      ]);

      expect(() => buildSummary(findings as Finding[])).not.toThrow();
      expect(findings).toHaveLength(2);
    });
  });
});