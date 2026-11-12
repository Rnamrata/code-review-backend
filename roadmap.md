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
        |-- llm adapter      (Ollama, optional)
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
| Findings merger: cross-analyzer dedupe only (same line or one line apart, categories must fit), same-source findings kept, a linter's wording, line and severity win | Done | `src/services/findingsMerger.service.ts` |
| Summary builder | Done | `src/services/reviewSummary.service.ts` |
| ESLint adapter (JS/TS, with security plugin) | Done | `src/services/adapters/eslint.adapter.ts` |
| Ruff adapter (Python; isolated config, `noqa` ignored, per-run timeout) | Done | `src/services/adapters/ruff.adapter.ts` |
| Config and env handling, logging | Done | `src/config/`, `src/utils/logger.util.ts` |
| GitHub Actions CI (Node 20 and 22; pinned Ruff install; typecheck, build, test, audit) | Done | `.github/workflows/ci.yml` |
| Express `app` separated from the listener, so tests can import it | Done | `src/app.ts`, `src/server.ts` |
| Vitest suite: 598 tests in 21 files (unit, adapter, orchestrator, route and end-to-end) | Done | `src/**/*.spec.ts`, `vitest.config.mts` |
| README and design notes (`planning-docs/`) match the current design | Done | `README.md`, `planning-docs/` |
| Analyzer hardening: sync throws become warnings, per-analyzer `timeoutMs`, abort signal (Ruff process is killed on timeout), `isSeverity` | Done | `src/services/reviewOrchestrator.service.ts`, `src/models/`, adapters |
| Request IDs (`X-Request-Id` in and out) and per-analyzer / per-review timing logs | Done | `src/controllers/review.controller.ts`, `src/utils/logger.util.ts` |
| LLM analyzer via Ollama: opt-in (`LLM_ENABLED`), JSON-schema reply, untrusted items dropped, severity capped at `high`, size limit, warning instead of failure | Done | `src/services/adapters/llm.adapter.ts` |
| LLM line accuracy and repeatability: the model quotes the offending line and the adapter locates it by that text; `category` required; temperature 0 with a fixed seed | Done | `src/services/adapters/llm.adapter.ts`, `src/config/app.config.ts` |
| Java checklist in the LLM prompt (`==` on strings, null results used unchecked, swallowed exceptions reported on the catch line); other languages get none | Done | `src/services/adapters/llm.adapter.ts` |
| ESLint on plain JavaScript: Node and browser globals (`globals` package), `require()` allowed in JS but still flagged in TypeScript, `detect-object-injection` rated `low`, identical repeated findings collapsed | Done | `src/services/adapters/eslint.adapter.ts` |
| Dependencies: unused `axios` removed and `npm audit fix` applied; production audit is 10 moderate, no critical or high | Done | `package.json` |
| End-to-end check with the real chatbot: upload, chat about a finding in a real session, Ollama down and review service down all verified | Done | `llm-chatbot` |
| Chatbot opening message built in code from the findings (exact counts, the review service's warnings shown, never called "clean" when a check did not run); 51 chatbot tests | Done | `llm-chatbot` repo: `src/modules/review_summary.py` |
| Chatbot repo: GitHub Actions CI (Python 3.12, tests on every pull request) and the Whisper speech model loaded lazily, so tests need no PyTorch or model download | Done | `llm-chatbot` repo: `.github/workflows/ci.yml` |
| OpenAPI 3.1 spec of the API (`/review`, `/health`, `/ready`, every error and header) with `curl` examples in the README | Done | `openapi.yaml`, `README.md` |
| Docker image (Node 22, Ruff pinned, non-root, read-only filesystem, health check on `/ready`), `docker-compose.yml`, and a CI job that builds the image and smoke-tests it; a stop with a review running waits for it (60 s grace period) | Done | `Dockerfile`, `docker-compose.yml`, `scripts/docker-smoke-test.sh`, `.github/workflows/ci.yml` |
| Hardening: rate limiting on `/review` (429 with `Retry-After`, refusals logged), CORS off unless `CORS_ORIGIN` is set and `*` refused in production, request body limit follows `MAX_FILE_SIZE_MB`, graceful shutdown (running reviews finish first), `GET /ready` checks Ruff and Ollama, startup failures exit with code 1 | Done | `src/middlewares/`, `src/shutdown.ts`, `src/services/readiness.service.ts`, `src/server.ts` |

### In progress

Nothing active. Phases A and B are complete, the pre-LLM hardening is merged, and the LLM analyzer is built and tuned (Phase D). Phase C hardening is done except schema validation and `logError` wiring. Next: those two items, then publishing the image.

### Known gaps

- The LLM finds only about half of the known issues, so it supplements the linters and cannot replace them. On 8 sample files (46 known issues) the linters and the LLM together report about 30; Java, which only the LLM reviews, reaches about 8 of 16 after the Java checklist. Checked on sample files only; try more real code.
- Results depend on the model more than on settings. Temperatures 0, 0.1 and 0.2 (three seeds each) and merging two runs gave no gain on average, and any prompt change reshuffles which issues a small model reports (the catch-line wording gained one Java finding and lost another). A larger coder model is the main lever left.
- The Java checklist does not catch unclosed readers and streams; adding it as a fourth item only added noise.
- A short quote (such as `}`) cannot be matched to a line, so that finding keeps the model's own line number, which can be one off.
- A merged finding shows only the linter's source, so a reader cannot tell the LLM agreed. An optional field (for example `alsoFoundBy`) would show it.
- 10 moderate audit findings remain, all one `minimatch` advisory reached through ESLint. npm's only fix is downgrading ESLint 10 to 9, so it is left alone; the code path is not reachable because the adapter lints a virtual file name, never a caller-supplied glob.
- Ollama normally serves one request at a time, so a chat answer and a review share a queue. The first review after a pause takes 15 s or more while the model loads (`LLM_KEEP_ALIVE` reduces this).
- ESLint cannot be interrupted once running; its abort support only refuses to start if already aborted. The 1 MB input cap bounds the worst case.
- Test coverage is not measured.
- `fileTypes.ts` lists Java, C++ and C#. Java is reviewed by the LLM only (when enabled); C++ and C# have no analyzer. The `.cpp`, `.c` and `.cs` extensions are also not in the allow-list.
- Request validation is inline in the controller rather than a schema in a middleware.
- Config keys with no consumer yet: the three complexity thresholds (planned for Phase E).
- The logger helper `logError` exists but is not called yet (see Phase C). `createChildLogger`, `logPerformance` and `logSecurity` (rate-limit events) are in use.
- Rate limits count requests by client address, in memory. The chatbot sends every user's reviews from one address, so they all share one counter: the default of 100 reviews per 15 minutes is for the whole chatbot, so raise `RATE_LIMIT_MAX_REQUESTS` if that is too tight. Behind a reverse proxy every client would appear with the proxy's address (a trust-proxy setting would be needed), and several instances would each count on their own.
- The logger catches uncaught exceptions and keeps the process running (`exitOnError: false`). Startup failures now exit with code 1, but a runtime uncaught exception is only logged.
- `GET /ready` answers 503 when Ruff is missing, although JavaScript reviews would still work.
- The Docker image is built and tested in CI but not published to a registry.
- The Ruff version is pinned in two places, the `Dockerfile` and the CI workflow, and the two must be changed together.
- The logger creates its log folder even with `LOG_TO_FILE=false`. The image works around it with `LOG_DIRECTORY=/tmp/logs`; a small code fix would create the folder only when file logging is on.
- Docker's default stop timeout (10 s) cuts a slow review off. The compose file sets 60 s; with plain `docker run`, use `--stop-timeout 60` or `docker stop -t 60`.
- `openapi.yaml` is written by hand. It was checked against the running service once, but nothing in CI keeps it in sync, so it can drift from the code. A contract test (real responses validated against the spec's schemas) would prevent that.
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
- [x] CI step to install Ruff (done in Phase B).

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

- [x] `express-rate-limit` on `/review`: `RATE_LIMIT_MAX_REQUESTS` per `RATE_LIMIT_WINDOW_MINUTES` per client address, 429 with the standard error shape and `Retry-After`, refusals logged with `logSecurity`.
- [x] Restrict CORS: no browser origin is allowed unless `CORS_ORIGIN` lists some (the chatbot calls from its server, not a browser); `*` is refused in production and the process exits with code 1.
- [ ] Move body validation into a schema (zod or similar) in a middleware; remove inline checks.
- [x] Align the body-size limit with `MAX_FILE_SIZE_MB`: the JSON limit is twice the file limit (JSON escaping), at least 1 MB.
- [x] Return 413 for oversized payloads with the standard error shape (covered by the route specs).
- [x] Add request IDs to logs and responses (`X-Request-Id`; a safe incoming value is kept, otherwise a UUID).
- [ ] Wire in the logger helpers that are already written (`createChildLogger` and `logPerformance` are done):
  - `createChildLogger` in the controller, with a request ID, so every log line of one review is correlated across the orchestrator and adapters.
  - `logPerformance` around each analyzer and the whole review, with a per-call threshold (the default 1 s would warn on every LLM call).
  - `logError` in the error handler and for failed analyzers, so stack traces are logged consistently.
  - `logSecurity` for rejected requests (`invalid_request`) and rate-limit events (rate-limit events are done).
  - Keep `logAnalysis` and `logRag` for Phase D, renaming `sessionId` to a request ID and `logRag` to `logLlm`.
- [x] Default `NODE_ENV` to production-safe behaviour so stack traces never reach a client by accident.
- [x] Graceful shutdown: on SIGINT or SIGTERM stop accepting connections, let running reviews finish (up to `SHUTDOWN_TIMEOUT_MS`), drop idle keep-alive connections, and stop at once on a second signal.
- [x] Remove dead code: the old CORS settings and the unused `host` config key. The rate-limit values are now used; the complexity thresholds stay for Phase E. (The `enable*` analysis flags, the unused `ReviewResponse` import and the empty `sessions/` and `uploads/` directories are already removed.)
- [x] `GET /ready` checks that Ruff runs and, when the LLM is on, that Ollama is reachable and has the configured model (200 or 503). `/health` stays cheap.
- [x] `server.ts` loads the app inside a try/catch and exits with code 1 when startup fails; the logger would otherwise swallow the error and let the process end with 0.

**Done when:** an abusive client is throttled, bad input gets a consistent 4xx, and a startup with unsafe CORS settings fails loudly. The first and last hold; the schema-validation item above is still open.

### Phase D - LLM analyzer (done)

**Decision:** the adapter calls Ollama directly (`/api/chat` with a JSON-schema output), on the same Ollama server the chatbot uses. Routing through the chatbot would make the two services depend on each other, and the chatbot's stored documents do not help review code. Retrieval can be added later as an optional extra step without changing the adapter's interface.

Prerequisites, done first on their own branch (merged) so the adapter has a safe base:

- [x] Per-analyzer timeouts: let each analyzer declare its own limit instead of the shared 45 s.
- [x] Make `analyze` cancellable (an abort signal), so a timed-out model call is stopped and not merely abandoned.
- [x] Treat a synchronous throw from an analyzer as a warning (wrap the call in the orchestrator, plus one test).
- [x] Wire `createChildLogger` and `logPerformance` (see Phase C) so analyzer timing is visible.
- [x] Re-add `isSeverity` to `finding.ts` for validating model output.

Adapter:

- [x] LLM settings in `app.config.ts` and `.env.example`: base URL, model (`qwen2.5-coder:7b`), timeout, context window, keep-alive, temperature, seed, size and finding limits.
- [x] Write `src/services/adapters/llm.adapter.ts` implementing `Analyzer`:
  - Send numbered code and the language to Ollama, with the reply constrained to a findings schema (line, severity, category, message, quoted line, optional suggestion).
  - Validate the reply and drop untrusted items: line outside the file, severity not allowed (`isSeverity`), empty message. Severity is capped at `high`; an unknown category is dropped; at most `LLM_MAX_FINDINGS` are kept.
  - Locate each finding by the line the model quoted, because models often miscount by one but copy text correctly.
  - Tag results `source: 'llm'`; keep `suggestion` populated where available.
  - Refuse files over `LLM_MAX_CODE_CHARS` with a warning, so the context window never truncates them silently.
- [x] Register it; make it optional via `LLM_ENABLED` (off by default) so linters still work if Ollama is down.
- [x] Use a shorter timeout than the shared 45 s (40 s, `LLM_TIMEOUT_MS`) so the chatbot's 60 s limit holds.
- [x] Tune the merger on real output: merge across analyzers within one line when both categories are known and equal, pick the closest candidate, and keep a linter's severity over the model's.
- [x] Make results repeatable: temperature 0 with a fixed seed.
- [x] Java checklist in the prompt for Java requests only. On three Java samples (16 known issues) it found 8 instead of 5.
- [x] Try other settings: temperatures 0.1 and 0.2 with three seeds each, and merging two runs. No gain on average (about 30 of 46 known issues across 8 files in every case), so the defaults stay at temperature 0 and seed 42. At temperature 0 the seed has no effect.

**Done when:** a review returns linter and LLM findings together, an Ollama outage yields a warning, and duplicates between sources are merged. All three hold.

**Measured** with an experiment harness (temperature 0, seed 7) on four sample files (Python, JavaScript, TypeScript, Java) with `qwen2.5-coder:7b`, two runs each:

| | Before tuning | After tuning |
|---|---|---|
| LLM findings on exactly the right line | 22 of 29 | 28 of 30 |
| Known issues reported | 22 of 50 | 28 of 50 |
| Files with identical results across two runs | 2 of 4 | 4 of 4 |

On the shipped settings (temperature 0, seed 42), run through the real service: all four files gave identical results across two runs, all 7 findings that only the LLM reported were on the correct line, and the linters and the LLM together reported 17 of 25 known issues.

Still open in this area: more real-world samples, a larger model for Java, and showing when the LLM agreed with a linter (see Known gaps).

### Phase E - Broader language and rule coverage

- [ ] Decide per language (Java now has the LLM only; C/C++, C# have nothing): add an adapter (for example Checkstyle/PMD, cppcheck) or remove it from `fileTypes.ts` and the extension allow-list so the config matches reality.
- [ ] Add complexity findings (ESLint `complexity`, Ruff `C901`) with configurable thresholds.
- [ ] Add CWE / OWASP tags to security findings (optional `Finding.references` field).
- [ ] Make rule sets configurable per request or by env, not only compiled in.

**Done when:** every extension the API accepts has at least one analyzer behind it.

### Phase F - Operations

- [x] Dockerfile (Node 22, Ruff 0.17.0 pinned, non-root user, read-only filesystem, health check on `/ready`) and `docker-compose.yml` for a local run with Ollama on the host machine. CI builds the image and smoke-tests it (`scripts/docker-smoke-test.sh`). A compose-managed Ollama is not included: on macOS it would run on the CPU only.
- [x] Readiness check that verifies the Ruff binary and Ollama reachability (`/health` stays cheap): done in Phase C as `GET /ready`.
- [ ] Structured JSON logs and basic metrics (request count, analyzer duration, failure rate).
- [ ] CI deploy or image-publish step (CI builds and smoke-tests the image; nothing publishes it yet).
- [x] OpenAPI spec (`openapi.yaml`, OpenAPI 3.1) for `/review`, `/health` and `/ready`, plus `curl` examples in the README. Checked against the real service: every example in the spec validates against its schemas, and the responses and headers of the running service match.

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
| C | Hardening | Mostly done (rate limiting, CORS, body limit, graceful shutdown, `/ready`, request IDs; schema validation and `logError` wiring open) |
| D | LLM analyzer (Ollama) | Done (opt-in; tuned on 4 sample files) |
| E | Language and rule coverage | Not started |
| F | Operations and docs | Started (readiness check, OpenAPI spec and Docker done) |
