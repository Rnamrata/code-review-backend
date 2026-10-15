# Code Review Backend - Roadmap

**Last updated:** October 2026
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
        |-- ruff adapter     (Python)      <- in progress
        |-- llm adapter      (RAG service) <- planned
        |
   findingsMerger    de-duplicate, linters win ties, sort by severity
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
| Findings merger with source priority | Done | `src/services/findingsMerger.service.ts` |
| Summary builder | Done | `src/services/reviewSummary.service.ts` |
| ESLint adapter (JS/TS, with security plugin) | Done | `src/services/adapters/eslint.adapter.ts` |
| Config and env handling, logging | Done | `src/config/`, `src/utils/logger.util.ts` |
| GitHub Actions CI (typecheck, build, test, audit; Node 20 and 22) | Done | `.github/workflows/ci.yml` |

### In progress (branch `feature/ruff-adapter`)

- `RUFF_BIN` and `RUFF_TIMEOUT_MS` added to `.env.example` and `app.config.ts`.
- The adapter itself (`src/services/adapters/ruff.adapter.ts`) is **not written yet** and is not registered in the orchestrator.

### Known gaps

- `npm test` is a no-op, so CI's test step proves nothing. `tests/` is empty.
- No LLM / RAG analyzer exists; `'llm'` is only a type and a merge priority.
- `fileTypes.ts` lists Java, C++ and C#, but no analyzer supports them. The `.cpp`, `.c` and `.cs` extensions are also not in the allow-list.
- No rate limiting; CORS defaults to `*`.
- Request validation is inline in the controller; the controller has an unused `ReviewResponse` import.
- The `maxFileSizeMB` limit (1 MB) is not coordinated with the `express.json` limit (2 MB).
- `sessions/`, `uploads/`, `dist/` and `planning-docs/` are leftovers from the earlier session-based design.

---

## 3. Roadmap

Phases are ordered by dependency. Each has an explicit "done when" so progress is checkable.

### Phase A - Finish Python support (current)

- [ ] Write `src/services/adapters/ruff.adapter.ts`
  - Run Ruff with `execFile` (never `exec`), passing code via stdin and `--output-format json`.
  - Use `appConfig.ruffBin` and `appConfig.ruffTimeoutMs`.
  - Map Ruff rule codes to `category` (for example `S*` to security, `F*` and `B*` to bug, the rest to maintainability) and to `severity`.
  - Skip results with no line number; treat a missing binary as a clear analyzer error, not a crash.
- [ ] Register `ruffAdapter` in the orchestrator's `analyzers` array.
- [ ] Document Ruff as a runtime dependency (README, CI step to install it).

**Done when:** a `.py` file with an unused import and a hard-coded `eval` returns findings with `source: 'ruff'`, and a missing Ruff binary returns a warning instead of failing the request.

### Phase B - Tests and a meaningful CI

- [ ] Choose a runner (Vitest or Jest) and make `npm test` run it.
- [ ] Unit tests, in priority order:
  - `findingsMerger`: tie-breaking, suggestion carry-over, sort order.
  - `normalizeLanguage` and `Validator`.
  - Category and severity mapping in the ESLint and Ruff adapters.
  - `reviewCode`: unsupported language, one analyzer failing, timeout path.
  - `buildSummary`.
- [ ] Integration tests with `supertest` against the Express app: valid review, each 400 case, unknown route.
- [ ] Export the Express `app` without starting the listener under test (split `app.ts` from `server.ts`).
- [ ] CI: install Ruff, run tests, fail the build on test failure.

**Done when:** CI fails if a mapping or merge rule regresses, and there is at least one passing test per service.

### Phase C - Hardening

- [ ] `express-rate-limit` on `/review`.
- [ ] Restrict CORS to the chatbot's origin via `CORS_ORIGIN`; fail on `*` in production.
- [ ] Move body validation into a schema (zod or similar) in a middleware; remove inline checks.
- [ ] Align the body-size limit with `MAX_FILE_SIZE_MB`.
- [ ] Return 413 for oversized payloads with the standard error shape.
- [ ] Add request IDs to logs and responses.
- [ ] Graceful shutdown: stop accepting connections and let in-flight reviews finish.
- [ ] Remove dead code: unused imports, unused CORS header, config flags with no consumer, leftover directories.

**Done when:** an abusive client is throttled, bad input gets a consistent 4xx, and a startup with unsafe CORS settings fails loudly.

### Phase D - LLM / RAG analyzer

- [ ] Add `src/config/rag.config.ts` (base URL, timeout, retries).
- [ ] Write `src/services/adapters/llm.adapter.ts` implementing `Analyzer`:
  - Send code and language to the RAG service, ask for structured findings.
  - Validate the response shape (`isSeverity`, line bounds) and drop malformed items.
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
| A | Ruff adapter | In progress |
| B | Tests and meaningful CI | Not started |
| C | Hardening | Not started |
| D | LLM / RAG analyzer | Not started |
| E | Language and rule coverage | Not started |
| F | Operations and docs | Not started |
