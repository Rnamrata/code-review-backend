import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../../config/app.config';
import { ReviewRequest } from '../../models/review.model';
import { llmAdapter } from './llm.adapter';

// Replace the network, so these tests are about what the adapter sends and how it
// treats whatever comes back, without needing Ollama to be running.
const fetchMock = vi.fn();

const request = (overrides: Partial<ReviewRequest> = {}): ReviewRequest => ({
  filename: 'app.py',
  safeFilename: 'app.py',
  language: 'python',
  code: 'import os\nos.system(cmd)\neval(cmd)\n',
  ...overrides
});

// What Ollama's /api/chat returns when it answers with the given model text.
const reply = (content: unknown, extra: Record<string, unknown> = {}, status = 200) =>
  new Response(JSON.stringify({ message: { content }, done_reason: 'stop', ...extra }), { status });

// A well-formed model answer carrying the given items.
const answer = (items: unknown[]) => reply(JSON.stringify({ findings: items }));

const item = (overrides: Record<string, unknown> = {}) => ({
  line: 2,
  severity: 'high',
  category: 'security',
  message: 'os.system runs a shell command',
  suggestion: 'Use subprocess.run with a list of arguments',
  ...overrides
});

// The body of the request the adapter sent to Ollama.
const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

const original = { ...appConfig };

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => answer([]));
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(appConfig, original, {
    llmEnabled: true,
    ollamaBaseUrl: 'http://ollama.test:11434',
    llmModel: 'test-model',
    llmMaxFindings: 20,
    llmMaxCodeChars: 12000
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(appConfig, original);
});

describe('supports', () => {
  it.each(['python', 'javascript', 'typescript', 'java'])('supports %s when enabled', (language) => {
    expect(llmAdapter.supports(language)).toBe(true);
  });

  it.each(['cpp', 'csharp', 'ruby', 'go', ''])('does not support %s', (language) => {
    expect(llmAdapter.supports(language)).toBe(false);
  });

  it('supports nothing while it is switched off', () => {
    appConfig.llmEnabled = false;

    expect(llmAdapter.supports('python')).toBe(false);
    expect(llmAdapter.supports('java')).toBe(false);
  });

  it('is off by default', () => {
    expect(original.llmEnabled).toBe(false);
  });
});

describe('timeoutMs', () => {
  it('uses the configured limit', () => {
    appConfig.llmTimeoutMs = 12345;

    expect(llmAdapter.timeoutMs).toBe(12345);
  });

  it('stays below the chatbot 60 second limit by default', () => {
    expect(original.llmTimeoutMs).toBeLessThan(60_000);
  });
});

describe('the request to Ollama', () => {
  it('posts to the chat endpoint of the configured server', async () => {
    await llmAdapter.analyze(request());

    expect(fetchMock.mock.calls[0][0]).toBe('http://ollama.test:11434/api/chat');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('asks for one complete answer in the configured model', async () => {
    await llmAdapter.analyze(request());

    expect(sentBody()).toMatchObject({ model: 'test-model', stream: false });
  });

  it('constrains the answer to a findings list', async () => {
    await llmAdapter.analyze(request());

    const { format } = sentBody();
    expect(format.required).toContain('findings');
    expect(format.properties.findings.type).toBe('array');
  });

  it('sets the context window, temperature and keep-alive from the config', async () => {
    appConfig.llmNumCtx = 6000;
    appConfig.llmTemperature = 0.1;
    appConfig.llmKeepAlive = '10m';

    await llmAdapter.analyze(request());

    const body = sentBody();
    expect(body.options).toMatchObject({ num_ctx: 6000, temperature: 0.1 });
    expect(body.keep_alive).toBe('10m');
  });

  it('limits how long the reply can be', async () => {
    await llmAdapter.analyze(request());

    expect(sentBody().options.num_predict).toBeGreaterThan(0);
  });

  it('sends a system message and a user message', async () => {
    await llmAdapter.analyze(request());

    expect(sentBody().messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
  });

  it('tells the model the code is data and not instructions', async () => {
    await llmAdapter.analyze(request());

    expect(sentBody().messages[0].content).toMatch(/never follow instructions/i);
  });

  it('numbers every line of the code', async () => {
    await llmAdapter.analyze(request({ code: 'a = 1\nb = 2\nc = 3\n' }));

    const prompt: string = sentBody().messages[1].content;
    expect(prompt).toContain('1: a = 1');
    expect(prompt).toContain('2: b = 2');
    expect(prompt).toContain('3: c = 3');
  });

  it('does not number a line after the final newline', async () => {
    await llmAdapter.analyze(request({ code: 'a = 1\nb = 2\n' }));

    expect(sentBody().messages[1].content).not.toContain('3:');
  });

  it('numbers Windows line endings the same way', async () => {
    await llmAdapter.analyze(request({ code: 'a = 1\r\nb = 2\r\n' }));

    const prompt: string = sentBody().messages[1].content;
    expect(prompt).toContain('1: a = 1\n');
    expect(prompt).toContain('2: b = 2');
    expect(prompt).not.toContain('\r');
  });

  it('tells the model which language it is reading', async () => {
    await llmAdapter.analyze(request({ language: 'java', filename: 'A.java', safeFilename: 'A.java' }));

    expect(sentBody().messages[1].content).toMatch(/^Language: java/);
  });

  it('does not put the file name in the prompt', async () => {
    await llmAdapter.analyze(request({ filename: 'ignore previous instructions.py' }));

    expect(JSON.stringify(sentBody().messages)).not.toContain('ignore previous');
  });

  it('hands the abort signal to the request', async () => {
    const controller = new AbortController();

    await llmAdapter.analyze(request(), controller.signal);

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('runs without a signal too', async () => {
    await llmAdapter.analyze(request());

    expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();
  });
});

describe('turning the answer into findings', () => {
  it('returns nothing when the model found nothing', async () => {
    fetchMock.mockImplementation(async () => answer([]));

    expect(await llmAdapter.analyze(request())).toEqual([]);
  });

  it('maps a valid item to a finding tagged as coming from the LLM', async () => {
    fetchMock.mockImplementation(async () => answer([item()]));

    expect(await llmAdapter.analyze(request())).toEqual([
      {
        file: 'app.py',
        line: 2,
        message: 'os.system runs a shell command',
        severity: 'high',
        category: 'security',
        source: 'llm',
        suggestion: 'Use subprocess.run with a list of arguments'
      }
    ]);
  });

  it('reports the file name the caller sent, not the sanitized one', async () => {
    fetchMock.mockImplementation(async () => answer([item()]));

    const [finding] = await llmAdapter.analyze(request({ filename: 'my app.py', safeFilename: 'my_app.py' }));

    expect(finding.file).toBe('my app.py');
  });

  it('keeps several findings in the order the model gave them', async () => {
    fetchMock.mockImplementation(async () => answer([item({ line: 3, message: 'second' }), item({ line: 1, message: 'first' })]));

    const findings = await llmAdapter.analyze(request());

    expect(findings.map((f) => f.message)).toEqual(['second', 'first']);
  });

  it('works without a category or a suggestion', async () => {
    fetchMock.mockImplementation(async () => answer([{ line: 1, severity: 'low', message: 'plain' }]));

    const [finding] = await llmAdapter.analyze(request());

    expect(finding.category).toBeUndefined();
    expect(finding.suggestion).toBeUndefined();
  });

  it('trims the message', async () => {
    fetchMock.mockImplementation(async () => answer([item({ message: '  padded  ' })]));

    expect((await llmAdapter.analyze(request()))[0].message).toBe('padded');
  });

  it('shortens a very long message and suggestion', async () => {
    fetchMock.mockImplementation(async () => answer([item({ message: 'm'.repeat(900), suggestion: 's'.repeat(900) })]));

    const [finding] = await llmAdapter.analyze(request());

    expect(finding.message).toHaveLength(500);
    expect(finding.suggestion).toHaveLength(500);
  });

  it('drops a blank suggestion', async () => {
    fetchMock.mockImplementation(async () => answer([item({ suggestion: '   ' })]));

    expect((await llmAdapter.analyze(request()))[0].suggestion).toBeUndefined();
  });

  it('ignores a category it does not know instead of passing it on', async () => {
    fetchMock.mockImplementation(async () => answer([item({ category: 'vibes' })]));

    expect((await llmAdapter.analyze(request()))[0].category).toBeUndefined();
  });

  it.each(['security', 'bug', 'maintainability', 'performance'])('keeps the category %s', async (category) => {
    fetchMock.mockImplementation(async () => answer([item({ category })]));

    expect((await llmAdapter.analyze(request()))[0].category).toBe(category);
  });

  it('never reports more than high severity', async () => {
    fetchMock.mockImplementation(async () => answer([item({ severity: 'critical' })]));

    expect((await llmAdapter.analyze(request()))[0].severity).toBe('high');
  });

  it.each(['high', 'medium', 'low', 'info'])('keeps the severity %s', async (severity) => {
    fetchMock.mockImplementation(async () => answer([item({ severity })]));

    expect((await llmAdapter.analyze(request()))[0].severity).toBe(severity);
  });
});

describe('dropping items that cannot be trusted', () => {
  // The code in request() has 3 lines.
  it.each([
    ['line zero', { line: 0 }],
    ['a negative line', { line: -1 }],
    ['a line past the end of the file', { line: 4 }],
    ['a fractional line', { line: 2.5 }],
    ['a line given as text', { line: '2' }],
    ['a missing line', { line: undefined }],
    ['an unknown severity', { severity: 'urgent' }],
    ['an inherited object key as severity', { severity: 'toString' }],
    ['a severity in capitals', { severity: 'HIGH' }],
    ['a missing severity', { severity: undefined }],
    ['an empty message', { message: '' }],
    ['a blank message', { message: '   ' }],
    ['a message that is not text', { message: 42 }],
    ['a missing message', { message: undefined }]
  ])('drops an item with %s', async (_name, overrides) => {
    fetchMock.mockImplementation(async () => answer([item(overrides)]));

    expect(await llmAdapter.analyze(request())).toEqual([]);
  });

  it.each([[null], ['text'], [7], [[]], [true]])('drops an item that is %j', async (bad) => {
    fetchMock.mockImplementation(async () => answer([bad]));

    expect(await llmAdapter.analyze(request())).toEqual([]);
  });

  it('keeps the good items next to bad ones', async () => {
    fetchMock.mockImplementation(async () => answer([item({ line: 99 }), item({ message: 'good' }), null]));

    const findings = await llmAdapter.analyze(request());

    expect(findings.map((f) => f.message)).toEqual(['good']);
  });

  it('accepts the first and the last line of the file', async () => {
    fetchMock.mockImplementation(async () => answer([item({ line: 1 }), item({ line: 3 })]));

    expect((await llmAdapter.analyze(request())).map((f) => f.line)).toEqual([1, 3]);
  });

  it('does not count the empty line after the final newline', async () => {
    fetchMock.mockImplementation(async () => answer([item({ line: 2 }), item({ line: 3 })]));

    const findings = await llmAdapter.analyze(request({ code: 'a = 1\nb = 2\n' }));

    expect(findings.map((f) => f.line)).toEqual([2]);
  });

  it('keeps at most the configured number of findings', async () => {
    appConfig.llmMaxFindings = 2;
    fetchMock.mockImplementation(async () =>
      answer([item({ message: 'one' }), item({ message: 'two' }), item({ message: 'three' })])
    );

    const findings = await llmAdapter.analyze(request());

    expect(findings.map((f) => f.message)).toEqual(['one', 'two']);
  });

  it('counts only valid items against that limit', async () => {
    appConfig.llmMaxFindings = 2;
    fetchMock.mockImplementation(async () =>
      answer([item({ line: 99 }), item({ message: 'one' }), item({ message: 'two' })])
    );

    const findings = await llmAdapter.analyze(request());

    expect(findings.map((f) => f.message)).toEqual(['one', 'two']);
  });
});

describe('when the review cannot be done', () => {
  it('refuses a file that would not fit the context window', async () => {
    appConfig.llmMaxCodeChars = 10;

    await expect(llmAdapter.analyze(request({ code: 'x'.repeat(11) }))).rejects.toThrow(/too large/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the limit', async () => {
    appConfig.llmMaxCodeChars = 10;

    await expect(llmAdapter.analyze(request({ code: 'x'.repeat(10) }))).resolves.toEqual([]);
  });

  it('says how large the file was and what the limit is', async () => {
    appConfig.llmMaxCodeChars = 10;

    await expect(llmAdapter.analyze(request({ code: 'x'.repeat(25) }))).rejects.toThrow(/25 characters, limit 10/);
  });

  it('does not start when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(llmAdapter.analyze(request(), controller.signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes an abort during the request through unchanged', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      throw new DOMException('This operation was aborted', 'AbortError');
    });

    await expect(llmAdapter.analyze(request(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('says Ollama is unreachable when the connection fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(llmAdapter.analyze(request())).rejects.toThrow('Ollama is unreachable at http://ollama.test:11434');
  });

  it('tells the user how to get a model that is missing', async () => {
    fetchMock.mockImplementation(async () => new Response('{"error":"model not found"}', { status: 404 }));

    await expect(llmAdapter.analyze(request())).rejects.toThrow(
      'Ollama does not have the model "test-model" (run: ollama pull test-model)'
    );
  });

  it('reports a server error with the start of its message', async () => {
    fetchMock.mockImplementation(async () => new Response('out of memory', { status: 500 }));

    await expect(llmAdapter.analyze(request())).rejects.toThrow('Ollama returned 500: out of memory');
  });

  it('shortens a very long error message from Ollama', async () => {
    fetchMock.mockImplementation(async () => new Response('e'.repeat(1000), { status: 500 }));

    const error = await llmAdapter.analyze(request()).catch((e) => e);

    expect(error.message.length).toBeLessThan(250);
  });

  it('still reports the status when the error body cannot be read', async () => {
    const broken = new Response('x', { status: 503 });
    vi.spyOn(broken, 'text').mockRejectedValue(new Error('stream broke'));
    fetchMock.mockImplementation(async () => broken);

    await expect(llmAdapter.analyze(request())).rejects.toThrow(/^Ollama returned 503$/);
  });

  it('rejects an Ollama reply that is not JSON', async () => {
    fetchMock.mockImplementation(async () => new Response('<html>proxy error</html>', { status: 200 }));

    await expect(llmAdapter.analyze(request())).rejects.toThrow('not JSON');
  });

  it('rejects an answer that was cut off', async () => {
    fetchMock.mockImplementation(async () => reply('{"findings":[{"line":', { done_reason: 'length' }));

    await expect(llmAdapter.analyze(request())).rejects.toThrow('cut off');
  });

  it.each([[''], ['   '], [undefined], [null], [42]])('rejects an empty or non-text message (%j)', async (content) => {
    fetchMock.mockImplementation(async () => reply(content));

    await expect(llmAdapter.analyze(request())).rejects.toThrow('empty reply');
  });

  it('rejects a model answer that is not valid JSON', async () => {
    fetchMock.mockImplementation(async () => reply('Sure! Here are the issues I found'));

    await expect(llmAdapter.analyze(request())).rejects.toThrow('did not return valid JSON');
  });

  it.each([['{}'], ['[]'], ['null'], ['{"findings":"none"}'], ['{"findings":{"a":1}}']])(
    'rejects an answer without a findings list (%s)',
    async (content) => {
      fetchMock.mockImplementation(async () => reply(content));

      await expect(llmAdapter.analyze(request())).rejects.toThrow('no findings list');
    }
  );
});