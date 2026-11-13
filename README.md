# code-review-backend

A small, stateless HTTP service that reviews source code. You send it one file's
code, it runs every analyzer that supports the file's language, and it returns a
merged, ranked list of findings.

It is built to be called by a chatbot, which sends code and reads `findings`.
The service holds no sessions and stores nothing.

## How it works

```
POST /review  { filename, language, code }
      |
  controller      validate body, extension and size; normalize language
      |
  orchestrator    pick analyzers for the language, run them in parallel
      |             (own timeout each; a failure becomes a warning)
      |-- ESLint adapter   JavaScript / TypeScript
      |-- Ruff adapter     Python
      |-- LLM adapter      optional, via Ollama (off by default)
      |
  merger          de-duplicate across analyzers, sort by severity
      |
  { findings, warnings, summary }
```

Analysis comes from real tools (ESLint, Ruff) and, when enabled, a local model
through Ollama; the service only translates their output into one `Finding` shape. Submitted code is never executed or saved.

## API

The full contract, with every response, error, header and example, is in [`openapi.yaml`](openapi.yaml)
(OpenAPI 3.1). Open it in the Swagger Editor or Redoc to browse it, or import it into Postman to get a
ready-made request for each endpoint. `src/openapi.contract.spec.ts` keeps the file honest: every example
in it must fit its schemas, and what the service really answers must fit what the file promises.

### `POST /review`

```json
{
  "filename": "app.py",
  "language": "python",
  "code": "print(undefined_name)\n"
}
```

Response (`200`):

```json
{
  "findings": [
    {
      "file": "app.py",
      "line": 1,
      "message": "Undefined name `undefined_name` (F821)",
      "severity": "medium",
      "category": "bug",
      "source": "ruff"
    }
  ],
  "warnings": [],
  "summary": {
    "total": 1,
    "bySeverity": { "critical": 0, "high": 0, "medium": 1, "low": 0, "info": 0 },
    "bySource": { "ruff": 1 },
    "byCategory": { "bug": 1 }
  }
}
```

Try it with `curl`:

```bash
curl -s -X POST http://localhost:4000/review \
  -H 'Content-Type: application/json' \
  -H 'X-Request-Id: my-first-review' \
  -d '{"filename":"app.py","language":"python","code":"print(undefined_name)\n"}'
```

- `findings` is top-level and sorted by severity, then line. Each has `file`,
  `line`, `message`, `severity`, and optionally `category`, `source`, `suggestion`.
- `warnings` lists non-fatal problems: an analyzer failed or timed out, or no
  analyzer supports the language. An empty `findings` list with a warning does
  **not** mean the code is clean.
- Errors return `400` (bad input), `413` (body too large), `429` (too many requests; the
  `Retry-After` header says when to try again) or `500`, with
  `{ success, error, message, timestamp }`.
- The optional `X-Request-Id` request header ties a review to the service's log lines and is sent back in
  the response (a UUID is generated when you leave it out). Every answer from `/review` carries it, errors
  included. Reviews also carry `RateLimit` and
  `RateLimit-Policy` headers, and a `429` carries `Retry-After`.

### `GET /health`

Returns `{ "status": "healthy", "timestamp": "..." }`. It only says the process is running.

### `GET /ready`

Checks what a review needs: that Ruff runs and, when `LLM_ENABLED=true`, that Ollama is
reachable and has the configured model. It answers `200` when everything passes and `503`
when something does not, so a container or load balancer can hold traffic back.

```json
{
  "ready": true,
  "checks": {
    "ruff": { "ok": true, "detail": "ruff 0.17.0" },
    "ollama": { "ok": true, "detail": "model qwen2.5-coder:7b is installed" }
  }
}
```

## Supported languages

| Language | Analyzer | Notes |
|---|---|---|
| JavaScript, TypeScript (`.js .jsx .ts .tsx`) | ESLint + security plugin | runs in-process |
| Python (`.py`) | Ruff | needs the `ruff` binary |
| Java (`.java`) | LLM only, with rule cards | needs `LLM_ENABLED=true`; otherwise the review returns a warning |
| Python, JavaScript, TypeScript, Java | LLM (optional) | a second opinion next to the linters |

`language` accepts aliases such as `js`, `ts`, `py`; if it is unknown the file
extension is used.

## Getting started

Requirements: **Node 20.19+** and, for Python analysis, **Ruff**
(`brew install ruff` or `pip install ruff`).

```bash
npm install
cp .env.example .env
npm run dev          # http://localhost:4000
```

Other scripts: `npm run build`, `npm start` (runs `dist/`), `npm run watch`, `npm test`.

### `GET /metrics`

Counters and timings in the Prometheus text format: answers by route and status, review and
analyzer durations, analyzer failures (split into `timeout` and `error`), findings by source and
severity, and refused requests, plus Node's own numbers. Labels never hold a filename, a request id
or any of the submitted code. The counters live in memory and start again from zero when the service
restarts. There is no key, like `/health`, so keep the service on an internal network.
`METRICS_ENABLED=false` removes the route. The full list is in [`openapi.yaml`](openapi.yaml).

## Logs and metrics

Logs go to the console, and to files when `LOG_TO_FILE=true`. With `LOG_FORMAT=json` (the default
when `NODE_ENV=production`, so also in the Docker image) the console prints one JSON object per
line, which a log collector can parse and filter:

```json
{"durationMs":113.29,"level":"info","message":"HTTP request","method":"POST","path":"/review","requestId":"demo-1","status":200,"timestamp":"2026-11-12T06:45:31.406Z"}
```

- Every line that belongs to a review carries the `requestId`, so one `grep` or filter follows a
  review from the access line through the analyzer timings to any error. Send your own
  `X-Request-Id` to find a review by the id your caller knows.
- There is one access line per answer. `/health`, `/ready` and `/metrics` are logged at `debug`
  level so probes do not drown out the reviews. Query strings and request bodies are never logged.
- `LOG_FORMAT=pretty` (the default elsewhere) prints coloured lines for reading in a terminal. The
  log files are always JSON.
- Timestamps are ISO 8601 in UTC in both formats.

Prometheus examples, for the metrics above:

```
# share of reviews where an analyzer failed, over 5 minutes
sum(rate(reviews_total{outcome="partial"}[5m])) / sum(rate(reviews_total[5m]))

# 95th percentile review time
histogram_quantile(0.95, sum(rate(review_duration_seconds_bucket[5m])) by (le))

# analyzers that time out
sum(rate(analyzer_failures_total{reason="timeout"}[5m])) by (analyzer)
```

## Docker

The image bundles Node, the compiled service and Ruff (pinned to 0.17.0). It runs as a normal
user, on a read-only filesystem, and logs JSON lines to the console.

```bash
docker build -t code-review-backend .
docker run --rm -p 4000:4000 --stop-timeout 60 code-review-backend
```

Or with Docker Compose, which also sets the stop timeout, the read-only filesystem and the defaults:

```bash
docker compose up --build                     # ESLint and Ruff only
REVIEW_LLM_ENABLED=true docker compose up --build    # also asks Ollama running on your machine
```

The service is then at `http://localhost:4000` (set `REVIEW_PORT` for another port). `docker ps`
shows `healthy` once `GET /ready` passes: Ruff runs and, when the LLM is on, Ollama has the model.

- **Ollama stays on your machine.** From a container the host is `host.docker.internal`, which is
  the default `OLLAMA_BASE_URL` in the compose file. On a Mac this keeps the model on the GPU:
  Ollama inside a container on macOS would run on the CPU only and be far slower. On Linux, start
  Ollama with `OLLAMA_HOST=0.0.0.0` so the container can reach it.
- **Stopping.** Give the container time to finish running reviews: `docker stop -t 60` (compose does
  this for you). Docker's default of 10 s cuts a slow review off.
- **Settings** are the variables in [Configuration](#configuration). With `docker run`, pass them with
  `-e`. The compose file takes them as `REVIEW_PORT`, `REVIEW_LLM_ENABLED`, `REVIEW_OLLAMA_URL`,
  `REVIEW_LLM_MODEL`, `REVIEW_RATE_LIMIT_MAX_REQUESTS` and `REVIEW_CORS_ORIGIN`. They have their own
  names because Compose reads the `.env` in this folder, which is the one for `npm run dev`:
  it names Ollama as `localhost`, which inside a container is the container itself.
- Your local `.env` is never copied into the image.
- Logs and metrics: the container prints JSON lines (see [Logs and metrics](#logs-and-metrics)) and
  serves `GET /metrics`.
- To check an image: `bash scripts/docker-smoke-test.sh code-review-backend`

### Published image

Every push to `master` and every release publishes the image, for `linux/amd64` and `linux/arm64`
(Apple Silicon and ARM servers run it natively), to the GitHub container registry:

```bash
docker run --rm -p 4000:4000 --stop-timeout 60 ghcr.io/rnamrata/code-review-backend:0.1.0
```

| Tag | Moves? | What it is |
|---|---|---|
| `0.1.0` | no | one release. Use this one in production |
| `0.1` | yes | the newest `0.1.x` release |
| `latest` | yes | the newest release |
| `edge` | yes | the latest `master`, not a release |
| `sha-abc1234` | no | one exact commit |

The image is tested before and after it is published (CI smoke-tests the built image, then pulls
the published one and tests that). Pass settings with `-e`, as in [Configuration](#configuration).
To pin an image completely, use its digest: `ghcr.io/rnamrata/code-review-backend@sha256:...`.

**Releasing.** Change `version` in `package.json` and in `openapi.yaml` (a test checks they match),
merge, then tag the merge commit and push the tag:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

CI refuses a tag that does not match the version in `package.json`.

## Optional LLM analyzer

The linters work on their own. To add a local model as a second opinion:

```bash
ollama serve                       # leave it running
ollama pull qwen2.5-coder:7b
# in .env:  LLM_ENABLED=true
npm run dev
```

Findings from the model have `"source": "llm"` and never rank above `high`.
Anything the model returns that cannot be trusted (a line outside the file, an
unknown severity, an empty message) is dropped. If Ollama is down, the model is
missing, the file is too large for the context window or the call times out, the
review still returns the linter findings plus a warning with the reason.

**Java rule cards.** The model reviews Java without a linter, so it is given short reminders of the
problems a small model tends to miss (SQL built from strings, hard-coded passwords, command
injection, path traversal, unsafe deserialization, XML external entities, weak hashes, `==` on
strings, unchecked null results, swallowed exceptions, unclosed resources, and a few more). A cheap
pattern check on the submitted code picks the cards that apply, at most six, and only those go into
the prompt; the code itself is never copied into it. The cards are in
[`src/services/adapters/javaRules.ts`](src/services/adapters/javaRules.ts), and a debug log line
lists the ones a review got. On 12 sample Java files they raised the known issues found from about 19
to about 30 of 44, and a Java review takes about 13 s instead of 8 s. They help the model; they do
not make it complete.

**Why the 7B model.** `qwen2.5-coder:7b` is the default because it did best on Java among the three tried. `qwen2.5-coder:14b` found about the same issues but invented more and took over twice as long (10 GB of memory), and `llama3.2` was twice as fast but missed a third of the issues and added many false ones. Details are in [roadmap.md](roadmap.md).

The first review after a pause can take 15 s or more while Ollama loads the model.
`LLM_KEEP_ALIVE` keeps it loaded between reviews. Ollama normally serves one request
at a time, so a chat answer and a review share the queue.

## Configuration

Set in `.env` (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | listen port |
| `NODE_ENV` | `production` | set `development` locally; only `development` includes stack traces in errors |
| `CORS_ORIGIN` | empty | browser origins allowed to call the service (comma separated). Empty allows none, which is right when only another server calls it; `*` is refused in production |
| `RUFF_BIN` | `ruff` | path to the Ruff binary |
| `RUFF_TIMEOUT_MS` | `15000` | Ruff run limit |
| `LLM_ENABLED` | `false` | turn the LLM analyzer on |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | where Ollama is running |
| `LLM_MODEL` | `qwen2.5-coder:7b` | model used for reviews |
| `LLM_TIMEOUT_MS` | `40000` | LLM run limit (keep it under the chatbot's 60 s) |
| `LLM_NUM_CTX`, `LLM_KEEP_ALIVE` | `8192`, `30m` | context window sent with each request; how long Ollama keeps the model loaded |
| `LLM_MAX_CODE_CHARS`, `LLM_MAX_FINDINGS` | `12000`, `20` | larger files skip the LLM with a warning; most findings kept per review |
| `MAX_FILE_SIZE_MB` | `1` | largest accepted code size; the request body may be twice as large (JSON escaping), at least 1 MB |
| `RATE_LIMIT_WINDOW_MINUTES`, `RATE_LIMIT_MAX_REQUESTS` | `15`, `100` | each client address may start this many reviews per window; more get `429` |
| `SHUTDOWN_TIMEOUT_MS` | `50000` | how long running reviews may finish after SIGTERM or SIGINT (keep it above `LLM_TIMEOUT_MS`) |
| `READINESS_TIMEOUT_MS` | `3000` | time limit for each check behind `GET /ready` |
| `ALLOWED_EXTENSIONS` | `.py,.js,.java,.ts,.jsx,.tsx` | accepted file extensions |
| `LOG_LEVEL`, `LOG_TO_CONSOLE`, `LOG_TO_FILE`, `LOG_DIRECTORY` | `info`, `true`, `true`, `./logs` | logging |
| `LOG_FORMAT` | `json` in production, otherwise `pretty` | `json` prints one JSON object per line; `pretty` is for a terminal. Log files are always JSON |
| `METRICS_ENABLED` | `true` | serve `GET /metrics`; `false` removes the route |

## Project layout

```
src/
  config/        environment settings
  constants/     language and extension maps, HTTP status codes
  controllers/   request handling for /review
  middlewares/   error handler, CORS, rate limiting, request id, request validation, access log, metrics
  models/        Finding, ReviewRequest, ReviewResponse, Analyzer
  schemas/       what a request to /review must look like (zod)
  routes/        route wiring
  services/
    adapters/    ESLint and Ruff adapters (one file per analyzer)
    reviewOrchestrator.service.ts
    findingsMerger.service.ts
    reviewSummary.service.ts
    metrics.service.ts   the counters and histograms behind GET /metrics
  utils/         logger, validator, response formatter
planning-docs/   design notes for the models and dependencies
scripts/         docker-smoke-test.sh, which checks a built image
Dockerfile       the image (also docker-compose.yml to run it)
openapi.yaml     the API contract (OpenAPI 3.1)
roadmap.md       phases and current status
```

## Adding an analyzer

Implement the `Analyzer` interface (`name`, `supports`, `analyze`) in
`src/services/adapters/`, add its name to `FindingSource`, and register it in the
orchestrator. See `planning-docs/service-dependency-map.txt`.

## CI

GitHub Actions runs on pull requests and on `master`: install, typecheck, build
and test on Node 20 and 22, plus an informational `npm audit`. A second job builds the Docker
image and smoke-tests it (`scripts/docker-smoke-test.sh`). A third job publishes the image to
`ghcr.io` (see [Published image](#published-image)) after both have passed, only for pushes to
`master` and for version tags, never for a pull request.

## Status

ESLint, Ruff and the optional LLM analyzer are working, with a test suite and CI.
Rate limiting, CORS, graceful shutdown and a readiness check are in place. Logs are JSON lines with a request id, and `GET /metrics` serves Prometheus metrics. The API contract is in [`openapi.yaml`](openapi.yaml). A Docker image and a compose file are included. See [roadmap.md](roadmap.md).
