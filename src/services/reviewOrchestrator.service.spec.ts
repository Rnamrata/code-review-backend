import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Finding } from '../models/finding';
import { ReviewRequest } from '../models/review.model';
import { logger } from '../utils/logger.util';
import { eslintAdapter } from './adapters/eslint.adapter';
import { ruffAdapter } from './adapters/ruff.adapter';
import { reviewCode } from './reviewOrchestrator.service';

// The real adapters run ESLint and Ruff. Replace them, so these tests are about
// how the orchestrator treats analyzers, not about what the analyzers find.
vi.mock('./adapters/eslint.adapter', () => ({
  eslintAdapter: { name: 'eslint', supports: vi.fn(), analyze: vi.fn() }
}));
vi.mock('./adapters/ruff.adapter', () => ({
  ruffAdapter: { name: 'ruff', supports: vi.fn(), analyze: vi.fn() }
}));
vi.mock('../utils/logger.util', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

const eslint = vi.mocked(eslintAdapter);
const ruff = vi.mocked(ruffAdapter);

const TIMEOUT_MS = 45_000;

const request = (overrides: Partial<ReviewRequest> = {}): ReviewRequest => ({
  filename: 'app.py',
  safeFilename: 'app.py',
  language: 'python',
  code: 'x = 1\n',
  ...overrides
});

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  file: 'whatever.tmp',
  line: 1,
  message: 'a problem',
  severity: 'low',
  category: 'bug',
  source: 'ruff',
  ...overrides
});

// Makes an analyzer claim exactly the given languages.
const supports = (adapter: typeof eslint, ...languages: string[]) =>
  adapter.supports.mockImplementation((language: string) => languages.includes(language));

beforeEach(() => {
  vi.clearAllMocks();
  eslint.supports.mockReset();
  ruff.supports.mockReset();
  eslint.analyze.mockReset();
  ruff.analyze.mockReset();

  supports(eslint, 'javascript', 'typescript');
  supports(ruff, 'python');
  eslint.analyze.mockResolvedValue([]);
  ruff.analyze.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('choosing analyzers', () => {
  it('runs only the analyzers that support the language', async () => {
    await reviewCode(request({ language: 'python' }));

    expect(ruff.analyze).toHaveBeenCalledTimes(1);
    expect(eslint.analyze).not.toHaveBeenCalled();
  });

  it('runs the JavaScript analyzer for JavaScript', async () => {
    await reviewCode(request({ language: 'javascript', filename: 'a.js', safeFilename: 'a.js' }));

    expect(eslint.analyze).toHaveBeenCalledTimes(1);
    expect(ruff.analyze).not.toHaveBeenCalled();
  });

  it('runs every analyzer that supports the language', async () => {
    supports(eslint, 'python');

    await reviewCode(request({ language: 'python' }));

    expect(eslint.analyze).toHaveBeenCalledTimes(1);
    expect(ruff.analyze).toHaveBeenCalledTimes(1);
  });

  it('hands each analyzer the request it received', async () => {
    const req = request();

    await reviewCode(req);

    expect(ruff.analyze).toHaveBeenCalledWith(req);
  });

  it('starts all analyzers before waiting for any of them', async () => {
    supports(eslint, 'python');
    let release!: () => void;
    const gate = new Promise<Finding[]>((resolve) => {
      release = () => resolve([]);
    });
    eslint.analyze.mockReturnValue(gate);
    ruff.analyze.mockReturnValue(gate);

    const pending = reviewCode(request());

    // Neither has finished, yet both have been started.
    expect(eslint.analyze).toHaveBeenCalledTimes(1);
    expect(ruff.analyze).toHaveBeenCalledTimes(1);

    release();
    await pending;
  });
});

describe('a language nobody supports', () => {
  it('returns no findings and a warning that names the language', async () => {
    const result = await reviewCode(request({ language: 'cobol' }));

    expect(result.findings).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].source).toBe('orchestrator');
    expect(result.warnings[0].message).toContain('cobol');
  });

  it('still returns a summary, with everything at zero', async () => {
    const result = await reviewCode(request({ language: 'cobol' }));

    expect(result.summary.total).toBe(0);
    expect(result.summary.bySeverity.critical).toBe(0);
  });

  it('does not run any analyzer', async () => {
    await reviewCode(request({ language: 'cobol' }));

    expect(eslint.analyze).not.toHaveBeenCalled();
    expect(ruff.analyze).not.toHaveBeenCalled();
  });

  it('logs the problem', async () => {
    await reviewCode(request({ language: 'cobol' }));

    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('combining results', () => {
  it('returns the findings of an analyzer', async () => {
    ruff.analyze.mockResolvedValue([finding({ line: 4, message: 'unused import' })]);

    const result = await reviewCode(request());

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ line: 4, message: 'unused import' });
    expect(result.warnings).toEqual([]);
  });

  it('reports every finding under the name the caller sent', async () => {
    ruff.analyze.mockResolvedValue([
      finding({ file: '/tmp/ruff-12345.py', line: 1 }),
      finding({ file: '<stdin>', line: 2, message: 'other' })
    ]);

    const result = await reviewCode(request({ filename: 'my app.py', safeFilename: 'my_app.py' }));

    expect(result.findings.map((f) => f.file)).toEqual(['my app.py', 'my app.py']);
  });

  it('merges findings from several analyzers and sorts them', async () => {
    supports(eslint, 'python');
    eslint.analyze.mockResolvedValue([finding({ source: 'eslint', line: 9, severity: 'low', message: 'from eslint' })]);
    ruff.analyze.mockResolvedValue([finding({ source: 'ruff', line: 2, severity: 'high', message: 'from ruff' })]);

    const result = await reviewCode(request());

    expect(result.findings.map((f) => f.message)).toEqual(['from ruff', 'from eslint']);
  });

  it('merges the same issue found by two analyzers into one finding', async () => {
    supports(eslint, 'python');
    eslint.analyze.mockResolvedValue([finding({ source: 'eslint', line: 3, severity: 'low', category: 'bug' })]);
    ruff.analyze.mockResolvedValue([finding({ source: 'ruff', line: 3, severity: 'high', category: 'bug' })]);

    const result = await reviewCode(request());

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('high');
  });

  it('builds the summary from the merged findings', async () => {
    ruff.analyze.mockResolvedValue([
      finding({ line: 1, severity: 'high', category: 'security' }),
      finding({ line: 2, severity: 'low', category: 'bug' })
    ]);

    const result = await reviewCode(request());

    expect(result.summary.total).toBe(2);
    expect(result.summary.bySeverity.high).toBe(1);
    expect(result.summary.bySource).toEqual({ ruff: 2 });
    expect(result.summary.byCategory).toEqual({ security: 1, bug: 1 });
  });
});

describe('when an analyzer fails', () => {
  it('turns the failure into a warning instead of failing the review', async () => {
    ruff.analyze.mockRejectedValue(new Error('Ruff not found at "ruff" (set RUFF_BIN)'));

    const result = await reviewCode(request());

    expect(result.findings).toEqual([]);
    expect(result.warnings).toEqual([
      { source: 'ruff', message: 'Ruff not found at "ruff" (set RUFF_BIN)' }
    ]);
  });

  it('still returns the findings of the analyzers that worked', async () => {
    supports(eslint, 'python');
    eslint.analyze.mockResolvedValue([finding({ source: 'eslint', message: 'from eslint' })]);
    ruff.analyze.mockRejectedValue(new Error('boom'));

    const result = await reviewCode(request());

    expect(result.findings.map((f) => f.message)).toEqual(['from eslint']);
    expect(result.warnings).toEqual([{ source: 'ruff', message: 'boom' }]);
  });

  it('names the analyzer that failed, not the first one that ran', async () => {
    // ESLint does not support python, so only Ruff runs. A warning must say "ruff".
    ruff.analyze.mockRejectedValue(new Error('boom'));

    const result = await reviewCode(request({ language: 'python' }));

    expect(result.warnings[0].source).toBe('ruff');
  });

  it('reports one warning per failed analyzer when all of them fail', async () => {
    supports(eslint, 'python');
    eslint.analyze.mockRejectedValue(new Error('eslint broke'));
    ruff.analyze.mockRejectedValue(new Error('ruff broke'));

    const result = await reviewCode(request());

    expect(result.findings).toEqual([]);
    expect(result.warnings.map((w) => w.source).sort()).toEqual(['eslint', 'ruff']);
  });

  it('copes with a failure that is not an Error object', async () => {
    ruff.analyze.mockRejectedValue('plain string failure');

    const result = await reviewCode(request());

    expect(result.warnings).toEqual([{ source: 'ruff', message: 'plain string failure' }]);
  });

  it('logs which analyzer failed', async () => {
    ruff.analyze.mockRejectedValue(new Error('boom'));

    await reviewCode(request());

    expect(logger.warn).toHaveBeenCalledWith(
      'Analyzer failed',
      expect.objectContaining({ analyzer: 'ruff' })
    );
  });

  it('keeps the summary consistent when everything failed', async () => {
    ruff.analyze.mockRejectedValue(new Error('boom'));

    const result = await reviewCode(request());

    expect(result.summary.total).toBe(0);
  });
});

describe('timeouts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('gives up on an analyzer that takes longer than 45 seconds', async () => {
    ruff.analyze.mockReturnValue(new Promise(() => undefined)); // never finishes

    const pending = reviewCode(request());
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    const result = await pending;

    expect(result.findings).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].source).toBe('ruff');
    expect(result.warnings[0].message).toMatch(/timed out after 45000 ms/);
  });

  it('keeps waiting until the full time has passed', async () => {
    ruff.analyze.mockReturnValue(new Promise(() => undefined));
    let settled = false;

    const pending = reviewCode(request()).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);

    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });

  it('still returns the findings of analyzers that finished before the timeout', async () => {
    supports(eslint, 'python');
    eslint.analyze.mockResolvedValue([finding({ source: 'eslint', message: 'quick' })]);
    ruff.analyze.mockReturnValue(new Promise(() => undefined));

    const pending = reviewCode(request());
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    const result = await pending;

    expect(result.findings.map((f) => f.message)).toEqual(['quick']);
    expect(result.warnings.map((w) => w.source)).toEqual(['ruff']);
  });

  it('does not leave a timer running after the analyzers finish', async () => {
    ruff.analyze.mockResolvedValue([finding()]);

    await reviewCode(request());

    expect(vi.getTimerCount()).toBe(0);
  });
});