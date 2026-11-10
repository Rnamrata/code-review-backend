import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Finding } from '../models/finding';
import { ReviewRequest } from '../models/review.model';
import { createChildLogger, logPerformance, logger } from '../utils/logger.util';
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
vi.mock('../utils/logger.util', () => {
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  // The child logger is the same object, so one set of assertions covers both.
  return { logger, createChildLogger: vi.fn(() => logger), logPerformance: vi.fn() };
});

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

    expect(ruff.analyze).toHaveBeenCalledWith(req, expect.any(AbortSignal));
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

describe('an analyzer that throws before returning a promise', () => {
  it('turns it into a warning instead of failing the review', async () => {
    ruff.analyze.mockImplementation(() => {
      throw new Error('threw synchronously');
    });

    const result = await reviewCode(request());

    expect(result.warnings).toEqual([{ source: 'ruff', message: 'threw synchronously' }]);
  });

  it('still returns the findings of the analyzers that worked', async () => {
    supports(eslint, 'python');
    eslint.analyze.mockResolvedValue([finding({ source: 'eslint', message: 'from eslint' })]);
    ruff.analyze.mockImplementation(() => {
      throw new Error('threw synchronously');
    });

    const result = await reviewCode(request());

    expect(result.findings.map((f) => f.message)).toEqual(['from eslint']);
    expect(result.warnings.map((w) => w.source)).toEqual(['ruff']);
  });
});

describe('cancelling analyzers', () => {
  it('gives each analyzer an abort signal that is not aborted', async () => {
    await reviewCode(request());

    const signal = ruff.analyze.mock.calls[0][1] as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it('gives every analyzer its own signal', async () => {
    supports(eslint, 'python');

    await reviewCode(request());

    const first = eslint.analyze.mock.calls[0][1];
    const second = ruff.analyze.mock.calls[0][1];
    expect(first).not.toBe(second);
  });

  it('does not abort an analyzer that finished in time', async () => {
    ruff.analyze.mockResolvedValue([finding()]);

    await reviewCode(request());

    expect((ruff.analyze.mock.calls[0][1] as AbortSignal).aborted).toBe(false);
  });
});

describe('logging', () => {
  it('creates a logger carrying the request id', async () => {
    await reviewCode(request({ requestId: 'req-123' }));

    expect(createChildLogger).toHaveBeenCalledWith({ requestId: 'req-123' });
  });

  it('logs how long each analyzer took', async () => {
    await reviewCode(request({ requestId: 'req-123' }));

    expect(logPerformance).toHaveBeenCalledWith(
      'analyzer ruff',
      expect.any(Number),
      { requestId: 'req-123' },
      expect.any(Number)
    );
  });

  it('logs the timing of an analyzer that failed', async () => {
    ruff.analyze.mockRejectedValue(new Error('boom'));

    await reviewCode(request());

    expect(logPerformance).toHaveBeenCalledWith('analyzer ruff', expect.any(Number), expect.anything(), expect.any(Number));
  });

  it('logs how long the whole review took', async () => {
    await reviewCode(request({ requestId: 'req-123' }));

    expect(logPerformance).toHaveBeenCalledWith(
      'review',
      expect.any(Number),
      expect.objectContaining({ requestId: 'req-123', analyzers: 1 }),
      expect.any(Number)
    );
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

    it('aborts the analyzer when it gives up on it', async () => {
    ruff.analyze.mockReturnValue(new Promise(() => undefined));

    const pending = reviewCode(request());
    const signal = ruff.analyze.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await pending;

    expect(signal.aborted).toBe(true);
  });

  it('uses the timeout an analyzer declares instead of the default', async () => {
    ruff.timeoutMs = 1_000;
    ruff.analyze.mockReturnValue(new Promise(() => undefined));

    const pending = reviewCode(request());
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;

    expect(result.warnings[0].message).toMatch(/timed out after 1000 ms/);
    ruff.timeoutMs = undefined;
  });

  it('waits longer for an analyzer that declares a longer timeout', async () => {
    ruff.timeoutMs = 120_000;
    ruff.analyze.mockReturnValue(new Promise(() => undefined));
    let settled = false;

    const pending = reviewCode(request()).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1_000);

    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(120_000);
    await pending;
    expect(settled).toBe(true);
    ruff.timeoutMs = undefined;
  });

  it('gives each analyzer its own timeout', async () => {
    supports(eslint, 'python');
    eslint.timeoutMs = 5_000;
    eslint.analyze.mockReturnValue(new Promise(() => undefined));
    ruff.analyze.mockResolvedValue([finding({ source: 'ruff', message: 'fast' })]);

    const pending = reviewCode(request());
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;

    expect(result.findings.map((f) => f.message)).toEqual(['fast']);
    expect(result.warnings[0]).toMatchObject({ source: 'eslint' });
    expect(result.warnings[0].message).toMatch(/timed out after 5000 ms/);
    eslint.timeoutMs = undefined;
  });

  it('does not leave a timer running after the analyzers finish', async () => {
    ruff.analyze.mockResolvedValue([finding()]);

    await reviewCode(request());

    expect(vi.getTimerCount()).toBe(0);
  });
});