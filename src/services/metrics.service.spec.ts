import { beforeEach, describe, expect, it } from 'vitest';
import { failureReason, metrics, registry, routeLabel } from './metrics.service';

// Reads one number back out of the registry: the sample of `metricName` whose labels include `labels`.
const sample = async (metricName: string, labels: Record<string, string> = {}): Promise<number> => {
  const all = (await registry.getMetricsAsJSON()) as { values: { metricName?: string; labels: Record<string, string>; value: number }[]; name: string }[];
  const values = all.flatMap((metric) => metric.values.map((v) => ({ ...v, metricName: v.metricName ?? metric.name })));
  return values
    .filter((v) => v.metricName === metricName && Object.entries(labels).every(([k, want]) => v.labels[k] === want))
    .reduce((sum, v) => sum + v.value, 0);
};

beforeEach(() => {
  metrics.reset();
});

describe('routeLabel', () => {
  it.each(['/review', '/health', '/ready', '/metrics'])('keeps the known route %s', (path) => {
    expect(routeLabel(path)).toBe(path);
  });

  it('ignores a trailing slash', () => {
    expect(routeLabel('/review/')).toBe('/review');
  });

  it.each(['/', '/admin', '/review/123', '/reviews', '/Review', '/health/extra'])('calls %s "unmatched"', (path) => {
    expect(routeLabel(path)).toBe('unmatched');
  });
});

describe('failureReason', () => {
  it.each([
    'ruff timed out after 45000 ms',
    'llm timed out after 40000 ms',
    'Ruff was stopped (SIGTERM), likely a timeout'
  ])('calls "%s" a timeout', (message) => {
    expect(failureReason(new Error(message))).toBe('timeout');
  });

  it.each([new Error('Ollama is unreachable'), 'plain text', undefined, null, 42])('calls %s an error', (value) => {
    expect(failureReason(value)).toBe('error');
  });

  it('also recognises a timeout that is not an Error object', () => {
    expect(failureReason('request timed out')).toBe('timeout');
  });
});

describe('recording', () => {
  it('counts http requests by method, route and status', async () => {
    metrics.recordHttp('POST', '/review', 200, 0.5);
    metrics.recordHttp('POST', '/review', 200, 0.7);
    metrics.recordHttp('POST', '/review', 400, 0.01);

    expect(await sample('http_requests_total', { method: 'POST', route: '/review', status: '200' })).toBe(2);
    expect(await sample('http_requests_total', { method: 'POST', route: '/review', status: '400' })).toBe(1);
  });

  it('keeps the time of each http request', async () => {
    metrics.recordHttp('GET', '/health', 200, 0.5);
    metrics.recordHttp('GET', '/health', 200, 1.5);

    expect(await sample('http_request_duration_seconds_count', { route: '/health' })).toBe(2);
    expect(await sample('http_request_duration_seconds_sum', { route: '/health' })).toBeCloseTo(2);
  });

  it('puts a path it does not know under "unmatched", whatever the query or the path was', async () => {
    metrics.recordHttp('GET', '/wp-login.php', 404, 0.001);
    metrics.recordHttp('GET', '/a/b/c', 404, 0.001);

    expect(await sample('http_requests_total', { route: 'unmatched' })).toBe(2);
    expect(await sample('http_requests_total', { route: '/wp-login.php' })).toBe(0);
  });

  it('times an analyzer without counting a failure when it succeeded', async () => {
    metrics.recordAnalyzer('ruff', 0.2);

    expect(await sample('analyzer_duration_seconds_count', { analyzer: 'ruff' })).toBe(1);
    expect(await sample('analyzer_failures_total')).toBe(0);
  });

  it('counts a failed analyzer with the reason, and still times it', async () => {
    metrics.recordAnalyzer('llm', 40, new Error('llm timed out after 40000 ms'));
    metrics.recordAnalyzer('llm', 0.1, new Error('Ollama is unreachable'));
    metrics.recordAnalyzer('ruff', 0.1, undefined);

    expect(await sample('analyzer_failures_total', { analyzer: 'llm', reason: 'timeout' })).toBe(1);
    expect(await sample('analyzer_failures_total', { analyzer: 'llm', reason: 'error' })).toBe(1);
    expect(await sample('analyzer_failures_total', { analyzer: 'ruff' })).toBe(0);
    expect(await sample('analyzer_duration_seconds_count', { analyzer: 'llm' })).toBe(2);
  });

  it('counts a failure whose error value is falsy', async () => {
    metrics.recordAnalyzer('eslint', 0.1, null);

    expect(await sample('analyzer_failures_total', { analyzer: 'eslint', reason: 'error' })).toBe(1);
  });

  it('counts a review by outcome and keeps its time', async () => {
    metrics.recordReview('completed', 1.2);
    metrics.recordReview('partial', 3);
    metrics.recordReview('partial', 3);

    expect(await sample('reviews_total', { outcome: 'completed' })).toBe(1);
    expect(await sample('reviews_total', { outcome: 'partial' })).toBe(2);
    expect(await sample('review_duration_seconds_count')).toBe(3);
  });

  it('counts findings by source and severity', async () => {
    metrics.recordReview('completed', 1, [
      { file: 'a', line: 1, message: 'm', severity: 'high', source: 'eslint' },
      { file: 'a', line: 2, message: 'm', severity: 'high', source: 'eslint' },
      { file: 'a', line: 3, message: 'm', severity: 'low', source: 'llm' },
      { file: 'a', line: 4, message: 'm', severity: 'low' }
    ]);

    expect(await sample('findings_total', { source: 'eslint', severity: 'high' })).toBe(2);
    expect(await sample('findings_total', { source: 'llm', severity: 'low' })).toBe(1);
    expect(await sample('findings_total', { source: 'unknown', severity: 'low' })).toBe(1);
  });

  it('counts refused requests', async () => {
    metrics.recordRateLimited();
    metrics.recordRateLimited();

    expect(await sample('rate_limited_total')).toBe(2);
  });
});

describe('render', () => {
  it('prints the Prometheus text format, with a help line and a type for each metric', async () => {
    metrics.recordRateLimited();

    const text = await metrics.render();

    expect(text).toContain('# HELP rate_limited_total ');
    expect(text).toContain('# TYPE rate_limited_total counter');
    expect(text).toContain('rate_limited_total 1');
    expect(text).toContain('# TYPE review_duration_seconds histogram');
  });

  it('includes the numbers of the Node process itself', async () => {
    const text = await metrics.render();

    expect(text).toContain('process_cpu_user_seconds_total');
    expect(text).toContain('nodejs_eventloop_lag_seconds');
  });

  it('announces the format in its content type', () => {
    expect(metrics.contentType).toMatch(/^text\/plain/);
  });
});

describe('reset', () => {
  it('starts every counter from zero', async () => {
    metrics.recordRateLimited();
    metrics.recordHttp('GET', '/health', 200, 0.1);

    metrics.reset();

    expect(await sample('rate_limited_total')).toBe(0);
    expect(await sample('http_requests_total')).toBe(0);
  });
});
