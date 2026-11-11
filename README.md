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

- `findings` is top-level and sorted by severity, then line. Each has `file`,
  `line`, `message`, `severity`, and optionally `category`, `source`, `suggestion`.
- `warnings` lists non-fatal problems: an analyzer failed or timed out, or no
  analyzer supports the language. An empty `findings` list with a warning does
  **not** mean the code is clean.
- Errors return `400` (bad input), `413` (body too large), `429` (too many requests; the
  `Retry-After` header says when to try again) or `500`, with
  `{ success, error, message, timestamp }`.

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
| Java (`.java`) | LLM only | needs `LLM_ENABLED=true`; otherwise the review returns a warning |
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

## Project layout

```
src/
  config/        environment settings
  constants/     language and extension maps, HTTP status codes
  controllers/   request handling for /review
  middlewares/   error handler, CORS, rate limiting
  models/        Finding, ReviewRequest, ReviewResponse, Analyzer
  routes/        route wiring
  services/
    adapters/    ESLint and Ruff adapters (one file per analyzer)
    reviewOrchestrator.service.ts
    findingsMerger.service.ts
    reviewSummary.service.ts
  utils/         logger, validator, response formatter
planning-docs/   design notes for the models and dependencies
roadmap.md       phases and current status
```

## Adding an analyzer

Implement the `Analyzer` interface (`name`, `supports`, `analyze`) in
`src/services/adapters/`, add its name to `FindingSource`, and register it in the
orchestrator. See `planning-docs/service-dependency-map.txt`.

## CI

GitHub Actions runs on pull requests and on `master`: install, typecheck, build
and test on Node 20 and 22, plus an informational `npm audit`.

## Status

ESLint, Ruff and the optional LLM analyzer are working, with a test suite and CI.
Rate limiting, CORS, graceful shutdown and a readiness check are in place. Docker is planned. See [roadmap.md](roadmap.md).

## License

MIT
