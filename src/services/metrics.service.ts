import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { Finding } from '../models/finding';

// The numbers behind GET /metrics, in the Prometheus text format.
//
// Labels only ever hold values from a short fixed list (a route from ROUTES, a status code, an
// analyzer name, a severity). Never a filename, a request id or any text of the submitted code:
// every new value of a label starts a new time series, and the code is not for logs or metrics.
export const registry = new Registry();

// Node's own numbers: memory, CPU, event-loop lag, open handles, garbage collection.
collectDefaultMetrics({ register: registry });

// Reviews can take tens of seconds (the model), so the buckets reach past the usual web latencies.
const SECONDS_BUCKETS = [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 40, 60];

const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests answered, by method, route and status code.',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry]
});

const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Time to answer an HTTP request, by method and route.',
  labelNames: ['method', 'route'] as const,
  buckets: SECONDS_BUCKETS,
  registers: [registry]
});

const reviews = new Counter({
  name: 'reviews_total',
  help: 'Reviews run. completed: every analyzer answered. partial: at least one analyzer failed or timed out. unsupported_language: no analyzer supports the language.',
  labelNames: ['outcome'] as const,
  registers: [registry]
});

const reviewDuration = new Histogram({
  name: 'review_duration_seconds',
  help: 'Time to run all analyzers of one review and merge their findings.',
  buckets: SECONDS_BUCKETS,
  registers: [registry]
});

const analyzerDuration = new Histogram({
  name: 'analyzer_duration_seconds',
  help: 'Time one analyzer took, whether it succeeded or not.',
  labelNames: ['analyzer'] as const,
  buckets: SECONDS_BUCKETS,
  registers: [registry]
});

const analyzerFailures = new Counter({
  name: 'analyzer_failures_total',
  help: 'Analyzer runs that failed. reason is timeout or error.',
  labelNames: ['analyzer', 'reason'] as const,
  registers: [registry]
});

const findingsTotal = new Counter({
  name: 'findings_total',
  help: 'Findings returned to callers, by the analyzer that reported them and by severity.',
  labelNames: ['source', 'severity'] as const,
  registers: [registry]
});

const rateLimited = new Counter({
  name: 'rate_limited_total',
  help: 'Review requests refused with 429 because the caller sent too many.',
  registers: [registry]
});

// The only routes that get a label of their own. Anything else is "unmatched", so a client that
// asks for thousands of different paths cannot create thousands of time series.
const ROUTES = new Set(['/review', '/health', '/ready', '/metrics']);

export const routeLabel = (path: string): string => {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return ROUTES.has(clean) ? clean : 'unmatched';
};

// Failures that come from a time limit (the orchestrator's, the model's, Ruff being stopped) are
// told apart from the rest, because "too slow" and "broken" are different things to fix.
export const failureReason = (error: unknown): 'timeout' | 'error' => {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|timeout/i.test(message) ? 'timeout' : 'error';
};

export const metrics = {
  recordHttp(method: string, path: string, status: number, seconds: number): void {
    const route = routeLabel(path);
    httpRequests.inc({ method, route, status: String(status) });
    httpDuration.observe({ method, route }, seconds);
  },

  recordAnalyzer(analyzer: string, seconds: number, error?: unknown): void {
    analyzerDuration.observe({ analyzer }, seconds);
    if (error !== undefined) analyzerFailures.inc({ analyzer, reason: failureReason(error) });
  },

  recordReview(outcome: 'completed' | 'partial' | 'unsupported_language', seconds: number, findings: Finding[] = []): void {
    reviews.inc({ outcome });
    reviewDuration.observe(seconds);
    for (const finding of findings) {
      findingsTotal.inc({ source: finding.source ?? 'unknown', severity: finding.severity });
    }
  },

  recordRateLimited(): void {
    rateLimited.inc();
  },

  async render(): Promise<string> {
    return registry.metrics();
  },

  contentType: registry.contentType,

  // For tests: start every counter and histogram from zero.
  reset(): void {
    registry.resetMetrics();
  }
};
