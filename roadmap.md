# Code Review Backend - Roadmap

**Last updated:** November 2026
**Architecture:** stateless, adapter-based review service
**Consumer:** the chatbot, which sends code and reads `findings`

---

## 1. What this service is

A small, stateless HTTP service. The chatbot sends one file's code, the service runs every analyzer that supports its language, merges the results and returns them.

```
POST /review  { filename, language, code }
        |
   controller        validate body, extension, size; normalize language
        |
   orchestrator      pick analyzers by language, run in parallel
        |             (per-analyzer timeout, failures become warnings)
        |-- eslint adapter   (JS / TS)
        |-- ruff adapter     (Python)
        |-- llm adapter      (RAG service) <- planned
        |
   findingsMerger    merge across analyzers only (same-source findings are kept),
        |             linters win ties, highest severity kept, sort by severity
        |
   reviewSummary     counts by severity / source / category
        |
   { findings, warnings, summary }
```

### Design principles

1. **Wrap real tools, don't reimplement them.** Static and security analysis comes from ESLint, Ruff and similar; we only translate their output into `Finding`.
2. **One contract for every analyzer.** Each implements `Analyzer` (`name`, `supports`, `analyze`). Adding a source means writing one file and registering it.
3. **Partial results beat failures.** One analyzer failing or timing out produces a `warning`, not a 500.
4. **Stateless.** No sessions, no uploads, no persistence. The chatbot owns conversation state.
5. **Never mislead.** If no analyzer supports a language, say so in `warnings` rather than returning a clean result.

---

## 2. Current state

### Done

| Area | Status | Where |
|---|---|---|
| Express server, helmet, CORS, morgan, health check, 404 + error handler | Done | `src/server.ts`, `src/middlewares/` |
| `POST /review` with request validation (shape, extension, size) | Done | `src/controllers/review.controller.ts` |
| Language normalization (aliases, extension fallback) | Done | `src/constants/fileTypes.ts` |
| Models: `Finding`, `Severity`, `ReviewRequest`, `ReviewResponse`, `Analyzer` | Done | `src/models/` |
| Orchestrator: parallel run, timeout, warnings, unsupported-language response | Done | `src/services/reviewOrchestrator.service.ts` |
| Findings merger: cross-analyzer dedupe only, same-source findings kept, higher severity wins | Done | `src/services/findingsMerger.service.ts` |
| Summary builder | Done | `src/services/reviewSummary.service.ts` |
| ESLint adapter (JS/TS, with security plugin) | Done | `src/services/adapters/eslint.adapter.ts` |
| Ruff adapter (Python; isolated config, `noqa` ignored, per-run timeout) | Done | `src/services/adapters/ruff.adapter.ts` |
| Config and env handling, logging | Done | `src/config/`, `src/utils/logger.util.ts` |
| GitHub Actions CI (Node 20 and 22; pinned Ruff install; typecheck, build, test, audit) | Done | `.github/workflows/ci.yml` |
| Express `app` separated from the listener, so tests can import it | Done | `src/app.ts`, `src/server.ts` |
| Vitest suite: 338 tests in 13 files (unit, adapter, orchestrator, route and end-to-end) | Done | `src/**/*.spec.ts`, `vitest.config.mts` |
| README and design notes (`planning-docs/`) match the current design | Done | `README.md`, `planning-docs/` |
| Analyzer hardening: sync throws become warnings, per-analyzer `timeoutMs`, abort signal (Ruff process is killed on timeout), `isSeverity` | Done | `src/services/reviewOrchestrator.service.ts`, `src/models/`, adapters |
| Request IDs (`X-Request-Id` in and out) and per-analyzer / per-review timing logs | Done | `src/controllers/review.controller.ts`, `src/utils/logger.util.ts` |

### In progress

Nothing active. Phases A and B are complete and the pre-LLM hardening is merged. Next is Phase D, which waits on the Ollama-or-RAG decision.

### Known gaps

- No LLM / RAG analyzer exists; `'llm'` is only a type and a merge priority.
- ESLint cannot be interrupted once running; its abort support only refuses to start if already aborted. The 1 MB input cap bounds the worst case.
- Test coverage is not measured.
- `fileTypes.ts` lists Java, C++ and C#, but no analyzer supports them. The `.cpp`, `.c` and `.cs` extensions are also not in the allow-list.
- No rate limiting; CORS defaults to `*`.
- Request validation is inline in the controller rather than a schema in a middleware.
- The `maxFileSizeMB` limit (1 MB) is not coordinated with the `express.json` limit (2 MB).
- Config keys with no consumer yet: `host`, the three complexity thresholds and the two rate-limit values. (The thresholds and rate limits are planned for Phases E and C; `host` has no plan and can go.)
- Logger helpers `logError` and `logSecurity` exist but are not called yet (see Phase C). `createChildLogger` and `logPerformance` are now in use.
- `/health` returns `"healthy"` and does not check Ruff or the LLM service.
- Two behaviours are untested end to end: a hung Ruff run (timeout kill), and ESLint on very large inputs, which cannot be aborted.

---

## 3. Roadmap

Phases are ordered by dependency. Each has an explicit "done when" so progress is checkable.

### Phase A - Finish Python support (done)

- [x] Write `src/services/adapters/ruff.adapter.ts`
  - Spawns Ruff with an argument array (never through a shell); code goes in via stdin with `--output-format json`.
  - `--isolated` ignores any local Ruff config, and `--ignore-noqa` stops submitted code from hiding findings.
  - Uses `appConfig.ruffBin` and `appConfig.ruffTimeoutMs`; the process is killed on timeout.
  - Maps Ruff codes to `category` and `severity`: `S*` is security/high, `B*`, `E9`, `F5`, `F63`, `F7`, `F82` are bug/medium, syntax errors are bug/high, the rest are maintainability/low.
  - Treats a missing binary, a non-0/1 exit, empty output or invalid JSON as an analyzer error, which becomes a warning.
- [x] Register `ruffAdapter` in the orchestrator's `analyzers` array.
- [x] Document Ruff as a runtime dependency in the README.
- [ ] CI step to install Ruff. This moves to Phase B, since it only matters once tests exercise the adapter.

**Done:** a `.py` file with an unused import and a hard-coded `eval` returns findings with `source: 'ruff'`, and a missing Ruff binary returns a warning instead of failing the request.

### Phase B - Tests and a meaningful CI (done)

- [x] Choose a runner and make `npm test` run it: Vitest 4 (supports the Node 20 and 22 CI matrix).
- [x] Unit tests, in priority order:
  - `findingsMerger`: tie-breaking, suggestion carry-over, sort order, one-to-one matching.
  - `normalizeLanguage` and `Validator`.
  - Category and severity mapping in the ESLint and Ruff adapters (Ruff also with its process mocked).
  - `reviewCode`: unsupported language, one analyzer failing, timeout path (fake timers).
  - `buildSummary`.
  - The error handler: client errors, hidden 5xx detail in production, stack only in development.
- [x] Integration tests with `supertest` against the Express app: valid review, each 400 case, 413, unknown route, real end-to-end reviews.
- [x] Export the Express `app` without starting the listener under test (`app.ts` split from `server.ts`).
- [x] CI: install Ruff (pinned), run tests, fail the build on test failure.

**Done:** 281 tests in 11 files. Each spec was checked by breaking the code under test on purpose, and CI passes on Node 20 and 22.

Not done in this phase: a coverage report, and a test for a hung Ruff process being killed for real (the kill is tested only with a mocked process).

### Phase C - Hardening

- [ ] `express-rate-limit` on `/review`.
- [ ] Restrict CORS to the chatbot's origin via `CORS_ORIGIN`; fail on `*` in production.
- [ ] Move body validation into a schema (zod or similar) in a middleware; remove inline checks.
- [ ] Align the body-size limit with `MAX_FILE_SIZE_MB`.
- [x] Return 413 for oversized payloads with the standard error shape (covered by the route specs).
- [x] Add request IDs to logs and responses (`X-Request-Id`; a safe incoming value is kept, otherwise a UUID).
- [ ] Wire in the logger helpers that are already written (`createChildLogger` and `logPerformance` are done):
  - `createChildLogger` in the controller, with a request ID, so every log line of one review is correlated across the orchestrator and adapters.
  - `logPerformance` around each analyzer and the whole review, with a per-call threshold (the default 1 s would warn on every LLM call).
  - `logError` in the error handler and for failed analyzers, so stack traces are logged consistently.
  - `logSecurity` for rejected requests (`invalid_request`) and, later, rate-limit events.
  - Keep `logAnalysis` and `logRag` for Phase D, renaming `sessionId` to a request ID and `logRag` to `logLlm`.
- [x] Default `NODE_ENV` to production-safe behaviour so stack traces never reach a client by accident.
- [ ] Graceful shutdown: stop accepting connections and let in-flight reviews finish.
- [ ] Remove dead code: the unused CORS header and the unused `host` config key. Keep the complexity thresholds (Phase E) and rate-limit values (this phase) and use them. (The `enable*` analysis flags, the unused `ReviewResponse` import and the empty `sessions/` and `uploads/` directories are already removed.)

**Done when:** an abusive client is throttled, bad input gets a consistent 4xx, and a startup with unsafe CORS settings fails loudly.

### Phase D - LLM / RAG analyzer

**Open decision:** how the adapter reaches the model. The original architecture called the model server directly (Ollama `/api/chat` with a JSON-schema output); the items below assume a separate RAG service. Decide this first, because it changes the config, the adapter and what has to be running locally.

Prerequisites, done first on their own branch (merged) so the adapter has a safe base:

- [x] Per-analyzer timeouts: let each analyzer declare its own limit instead of the shared 45 s.
- [x] Make `analyze` cancellable (an abort signal), so a timed-out model call is stopped and not merely abandoned.
- [x] Treat a synchronous throw from an analyzer as a warning (wrap the call in the orchestrator, plus one test).
- [x] Wire `createChildLogger` and `logPerformance` (see Phase C) so analyzer timing is visible.
- [x] Re-add `isSeverity` to `finding.ts` for validating model output.

Adapter:

- [ ] Add `src/config/rag.config.ts` (base URL, timeout, retries).
- [ ] Write `src/services/adapters/llm.adapter.ts` implementing `Analyzer`:
  - Send code and language to the RAG service, ask for structured findings.
  - Validate the response shape and drop malformed items: severity in the allowed set, line within the file. Use `isSeverity` from `finding.ts`.
  - Tag results `source: 'llm'`; keep `suggestion` populated where available.
- [ ] Register it; make it optional via env flag so linters still work if RAG is down.
- [ ] Use a shorter timeout than the shared 45 s so the chatbot's 60 s limit holds.
- [ ] Tune the merger once real output exists (for example dedupe on line proximity or message similarity, not only `file:line:category`).

**Done when:** a review returns linter and LLM findings together, an RAG outage yields a warning, and duplicates between sources are merged.

### Phase E - Broader language and rule coverage

- [ ] Decide per language (Java, C/C++, C#): add an adapter (for example Checkstyle/PMD, cppcheck) or remove it from `fileTypes.ts` and the extension allow-list so the config matches reality.
- [ ] Add complexity findings (ESLint `complexity`, Ruff `C901`) with configurable thresholds.
- [ ] Add CWE / OWASP tags to security findings (optional `Finding.references` field).
- [ ] Make rule sets configurable per request or by env, not only compiled in.

**Done when:** every extension the API accepts has at least one analyzer behind it.

### Phase F - Operations

- [ ] Dockerfile with Node and Ruff pinned; `docker-compose` for local run with the RAG service.
- [ ] Readiness check that verifies the Ruff binary and RAG reachability (`/health` stays cheap).
- [ ] Structured JSON logs and basic metrics (request count, analyzer duration, failure rate).
- [ ] CI deploy or image-publish step.
- [ ] OpenAPI spec for `POST /review` and a README with example requests.

**Done when:** a fresh machine can run the service with one command, and the API is documented.

---

## 4. Out of scope (deliberately)

These were part of the earlier session-based plan and are **not** being built:

- Sessions, file upload, JSON persistence, progress polling, review cancel.
- Hand-written security, complexity and style analyzers.
- Report grades, weighted scores and action plans.
- Chat and explain-issue endpoints (the chatbot owns the conversation).

Revisit only if the chatbot needs the service to hold state or to produce scored reports. Any such feature should be added as a new layer on top of `/review`, not by changing the adapter contract.

---

## 5. Working agreements

- **Add an analyzer:** implement `Analyzer`, add a unit test, register it in the orchestrator, add its `FindingSource` value, update this file.
- **Add a field to `Finding`:** make it optional first so the chatbot keeps working; document it.
- **Never break the response shape:** the chatbot reads `findings`; `warnings` and `summary` are extras.
- **Branch per phase item**, PR into `master`; CI must pass.

---

## 6. Progress tracker

| Phase | Scope | Status |
|---|---|---|
| Foundation | Server, `/review`, orchestrator, merger, summary, ESLint adapter, CI | Done |
| A | Ruff adapter | Done |
| B | Tests and meaningful CI | Done |
| C | Hardening | Started (413 shape and production-safe `NODE_ENV` done) |
| D | LLM / RAG analyzer | Not started |
| E | Language and rule coverage | Not started |
| F | Operations and docs | Not started |
