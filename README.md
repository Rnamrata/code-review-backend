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
      |-- LLM adapter      planned
      |
  merger          de-duplicate across analyzers, sort by severity
      |
  { findings, warnings, summary }
```

Analysis comes from real tools (ESLint, Ruff); the service only translates their
output into one `Finding` shape. Submitted code is never executed or saved.

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
- Errors return `400` (bad input), `413` (body too large) or `500`, with
  `{ success, error, message, timestamp }`.

### `GET /health`

Returns `{ "status": "healthy", "timestamp": "..." }`.

## Supported languages

| Language | Analyzer | Notes |
|---|---|---|
| JavaScript, TypeScript (`.js .jsx .ts .tsx`) | ESLint + security plugin | runs in-process |
| Python (`.py`) | Ruff | needs the `ruff` binary |
| Java (`.java`) | none yet | returns a warning |

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

Other scripts: `npm run build`, `npm start` (runs `dist/`), `npm run watch`.
`npm test` is a placeholder for now.

## Configuration

Set in `.env` (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | listen port |
| `NODE_ENV` | `production` | set `development` locally; only `development` includes stack traces in errors |
| `CORS_ORIGIN` | `*` | allowed origin; restrict it outside local use |
| `RUFF_BIN` | `ruff` | path to the Ruff binary |
| `RUFF_TIMEOUT_MS` | `15000` | Ruff run limit |
| `MAX_FILE_SIZE_MB` | `1` | largest accepted code size |
| `ALLOWED_EXTENSIONS` | `.py,.js,.java,.ts,.jsx,.tsx` | accepted file extensions |
| `LOG_LEVEL`, `LOG_TO_CONSOLE`, `LOG_TO_FILE`, `LOG_DIRECTORY` | `info`, `true`, `true`, `./logs` | logging |

## Project layout

```
src/
  config/        environment settings
  constants/     language and extension maps, HTTP status codes
  controllers/   request handling for /review
  middlewares/   error handler
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

ESLint and Ruff analysis are working. Tests, an LLM analyzer, hardening
(rate limiting, CORS) and Docker are planned. See [roadmap.md](roadmap.md).

## License

MIT
