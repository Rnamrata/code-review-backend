import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../../config/app.config';
import { ReviewRequest } from '../../models/review.model';
import { ruffAdapter } from './ruff.adapter';

// Replace the real process launcher, so these tests exercise how the adapter
// handles every kind of process outcome without needing Ruff at all.
vi.mock('child_process', () => ({ spawn: vi.fn() }));

const spawnMock = vi.mocked(spawn);

interface Script {
  stdout?: string | string[];
  stderr?: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  error?: NodeJS.ErrnoException;
  stdinError?: boolean;
}

let lastChild: any;

// Builds a stand-in for the Ruff process that plays back what the script says.
function stub(script: Script): void {
  spawnMock.mockImplementation((() => {
    const child: any = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
    child.kill = vi.fn();
    lastChild = child;

    setImmediate(() => {
      if (script.error) {
        child.emit('error', script.error);
        return;
      }
      if (script.stdinError) child.stdin.emit('error', new Error('EPIPE'));
      for (const chunk of [script.stdout ?? []].flat()) child.stdout.emit('data', chunk);
      if (script.stderr) child.stderr.emit('data', script.stderr);
      const code = 'code' in script ? script.code : 0;
      child.emit('close', code, script.signal ?? null);
    });

    return child;
  }) as any);
}

const request = (overrides: Partial<ReviewRequest> = {}): ReviewRequest => ({
  filename: 'app.py',
  safeFilename: 'app.py',
  language: 'python',
  code: 'import os\n',
  ...overrides
});

// One Ruff diagnostic, in the JSON shape Ruff prints.
const diagnostic = (o: {
  code?: string | null;
  message?: string;
  row?: number;
  fix?: { message?: string } | null;
} = {}) => ({
  code: o.code === undefined ? 'F401' : o.code,
  message: o.message ?? 'something is wrong',
  location: { row: o.row ?? 1, column: 1 },
  fix: o.fix === undefined ? null : o.fix
});

const json = (...diagnostics: object[]) => JSON.stringify(diagnostics);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('how the adapter starts Ruff', () => {
  it('runs the configured binary', async () => {
    stub({ stdout: '[]', code: 0 });
    await ruffAdapter.analyze(request());

    expect(spawnMock.mock.calls[0][0]).toBe(appConfig.ruffBin);
  });

  it('asks for JSON output read from stdin', async () => {
    stub({ stdout: '[]', code: 0 });
    await ruffAdapter.analyze(request());

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args[0]).toBe('check');
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    expect(args[args.length - 1]).toBe('-');
  });

  it('ignores local Ruff config and noqa comments', async () => {
    stub({ stdout: '[]', code: 0 });
    await ruffAdapter.analyze(request());

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toContain('--isolated');
    expect(args).toContain('--ignore-noqa');
    expect(args).toContain('--no-cache');
  });

  it('passes the file name with "=", so a leading hyphen is not read as a flag', async () => {
    stub({ stdout: '[]', code: 0 });
    await ruffAdapter.analyze(request({ filename: '-rf.py', safeFilename: '-rf.py' }));

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toContain('--stdin-filename=-rf.py');
    expect(args).not.toContain('--stdin-filename');
  });

  it('never passes the submitted code as an argument', async () => {
    stub({ stdout: '[]', code: 0 });
    await ruffAdapter.analyze(request({ code: 'import os; os.system("rm -rf /")' }));

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args.join(' ')).not.toContain('rm -rf');
  });

  it('writes the code to stdin', async () => {
    stub({ stdout: '[]', code: 0 });
    await ruffAdapter.analyze(request({ code: 'x = 1\n' }));

    expect(lastChild.stdin.end).toHaveBeenCalledWith('x = 1\n');
  });

  it('applies the configured timeout', async () => {
    stub({ stdout: '[]', code: 0 });
    await ruffAdapter.analyze(request());

    const options = spawnMock.mock.calls[0][2] as { timeout: number };
    expect(options.timeout).toBe(appConfig.ruffTimeoutMs);
  });
});

describe('when Ruff cannot be used', () => {
  it('explains that the binary was not found and how to point at it', async () => {
    const error: NodeJS.ErrnoException = new Error('spawn ruff ENOENT');
    error.code = 'ENOENT';
    stub({ error });

    await expect(ruffAdapter.analyze(request())).rejects.toThrow(/not found.*RUFF_BIN/);
  });

  it('passes other launch errors through', async () => {
    const error: NodeJS.ErrnoException = new Error('spawn ruff EACCES');
    error.code = 'EACCES';
    stub({ error });

    await expect(ruffAdapter.analyze(request())).rejects.toThrow('EACCES');
  });

  it('fails when Ruff itself fails (exit code 2), including its error text', async () => {
    stub({ stdout: '', stderr: 'error: unexpected argument', code: 2 });

    await expect(ruffAdapter.analyze(request())).rejects.toThrow(/failed \(exit 2\).*unexpected argument/);
  });

  it('fails when Ruff reports findings but prints nothing', async () => {
    stub({ stdout: '', code: 1 });

    await expect(ruffAdapter.analyze(request())).rejects.toThrow(/no output/);
  });

  it('fails when the output is not JSON', async () => {
    stub({ stdout: 'this is not json', code: 1 });

    await expect(ruffAdapter.analyze(request())).rejects.toThrow(/invalid JSON/);
  });

  it('fails when the process is stopped by a signal, such as the timeout', async () => {
    stub({ stdout: '', code: null, signal: 'SIGTERM' });

    await expect(ruffAdapter.analyze(request())).rejects.toThrow(/SIGTERM.*timeout/);
  });

  it('stops Ruff and fails when the output is far too large', async () => {
    stub({ stdout: 'x'.repeat(6 * 1024 * 1024), code: 1 });

    await expect(ruffAdapter.analyze(request())).rejects.toThrow(/size limit/);
    expect(lastChild.kill).toHaveBeenCalled();
  });

  it('is not brought down by a stdin error when Ruff exits early', async () => {
    stub({ stdout: '[]', code: 0, stdinError: true });

    await expect(ruffAdapter.analyze(request())).resolves.toEqual([]);
  });
});

describe('reading Ruff output', () => {
  it('treats exit 0 with empty output as no findings', async () => {
    stub({ stdout: '', code: 0 });

    expect(await ruffAdapter.analyze(request())).toEqual([]);
  });

  it('reads output that arrives in several chunks', async () => {
    const whole = json(diagnostic({ code: 'F401', row: 3 }));
    stub({ stdout: [whole.slice(0, 20), whole.slice(20)], code: 1 });

    const findings = await ruffAdapter.analyze(request());

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
  });

  it('uses the original filename and tags the source', async () => {
    stub({ stdout: json(diagnostic()), code: 1 });

    const [finding] = await ruffAdapter.analyze(request({ filename: 'my app.py', safeFilename: 'my_app.py' }));

    expect(finding.file).toBe('my app.py');
    expect(finding.source).toBe('ruff');
  });

  it('appends the rule code to the message', async () => {
    stub({ stdout: json(diagnostic({ code: 'F401', message: '`os` imported but unused' })), code: 1 });

    const [finding] = await ruffAdapter.analyze(request());

    expect(finding.message).toBe('`os` imported but unused (F401)');
  });

  it('uses the fix text as the suggestion', async () => {
    stub({ stdout: json(diagnostic({ fix: { message: 'Remove unused import' } })), code: 1 });

    const [finding] = await ruffAdapter.analyze(request());

    expect(finding.suggestion).toBe('Remove unused import');
  });

  it('leaves the suggestion out when there is no fix', async () => {
    stub({ stdout: json(diagnostic({ fix: null })), code: 1 });

    const [finding] = await ruffAdapter.analyze(request());

    expect(finding.suggestion).toBeUndefined();
  });

  it('drops diagnostics that have no usable line number', async () => {
    stub({ stdout: json(diagnostic({ row: 0 }), diagnostic({ row: 4 })), code: 1 });

    const findings = await ruffAdapter.analyze(request());

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(4);
  });
});

describe('severity and category by rule code', () => {
  it.each([
    ['S307', 'high', 'security'],
    ['S608', 'high', 'security'],
    ['B006', 'medium', 'bug'],
    ['B008', 'medium', 'bug'],
    ['E902', 'medium', 'bug'],
    ['F821', 'medium', 'bug'],
    ['F632', 'medium', 'bug'],
    ['F541', 'medium', 'bug'],
    ['F704', 'medium', 'bug'],
    ['F401', 'low', 'maintainability'],
    ['F841', 'low', 'maintainability'],
    ['F403', 'low', 'maintainability'],
    ['E402', 'low', 'maintainability'],
    ['C901', 'low', 'maintainability']
  ] as const)('maps %s to %s / %s', async (code, severity, category) => {
    stub({ stdout: json(diagnostic({ code })), code: 1 });

    const [finding] = await ruffAdapter.analyze(request());

    expect(finding).toMatchObject({ severity, category });
  });
});

describe('syntax errors', () => {
  it('reports a single high severity bug without a rule code', async () => {
    stub({ stdout: json(diagnostic({ code: 'invalid-syntax', message: 'Expected an expression' })), code: 1 });

    const findings = await ruffAdapter.analyze(request());

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'high', category: 'bug', message: 'Expected an expression' });
  });

  it('treats a diagnostic with no code as a syntax error', async () => {
    stub({ stdout: json(diagnostic({ code: null, message: 'Unexpected token' })), code: 1 });

    const [finding] = await ruffAdapter.analyze(request());

    expect(finding).toMatchObject({ severity: 'high', category: 'bug' });
    expect(finding.message).toBe('Unexpected token');
  });

  it('keeps only the first of several syntax errors', async () => {
    stub({
      stdout: json(
        diagnostic({ code: 'invalid-syntax', message: 'first', row: 1 }),
        diagnostic({ code: 'invalid-syntax', message: 'unexpected EOF', row: 2 })
      ),
      code: 1
    });

    const findings = await ruffAdapter.analyze(request());

    expect(findings.map((f) => f.message)).toEqual(['first']);
  });

  it('drops every other finding when the code does not parse', async () => {
    stub({
      stdout: json(
        diagnostic({ code: 'F401', row: 1 }),
        diagnostic({ code: 'invalid-syntax', message: 'broken', row: 5 })
      ),
      code: 1
    });

    const findings = await ruffAdapter.analyze(request());

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe('broken');
  });
});