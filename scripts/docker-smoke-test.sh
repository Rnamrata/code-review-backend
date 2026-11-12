#!/usr/bin/env bash
# Starts the image and checks that it behaves the way the service promises, then stops it.
#
#   scripts/docker-smoke-test.sh [image]        (default: code-review-backend:local)
#
# It checks: the container becomes healthy, /health and /ready answer, a JavaScript review finds
# an ESLint finding, a Python review finds a Ruff finding (so Ruff really is in the image), the
# container does not run as root, and `docker stop` ends it with exit code 0.
set -euo pipefail

IMAGE="${1:-code-review-backend:local}"
NAME="review-smoke-$$"
PORT="${SMOKE_PORT:-4190}"
BASE="http://127.0.0.1:${PORT}"

fail() {
  echo "FAIL: $*" >&2
  docker logs "$NAME" 2>&1 | tail -30 >&2 || true
  exit 1
}
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Same restrictions as the compose file: read-only filesystem, no new privileges.
docker run -d --name "$NAME" --init --read-only --tmpfs /tmp \
  --security-opt no-new-privileges:true -p "${PORT}:4000" "$IMAGE" >/dev/null

echo "Waiting for the container to become healthy..."
for i in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$NAME")"
  [ "$status" = "healthy" ] && break
  [ "$i" = "60" ] && fail "the container was not healthy after 60 s (status: $status)"
  sleep 1
done
echo "  healthy"

curl -fsS "$BASE/health" | grep -q '"status":"healthy"' || fail "/health did not say healthy"
curl -fsS "$BASE/ready" | grep -q '"ready":true' || fail "/ready did not say ready"
echo "  /health and /ready answer"

js="$(curl -fsS -X POST "$BASE/review" -H 'Content-Type: application/json' -H 'X-Request-Id: smoke-1' \
  -d '{"filename":"a.js","language":"js","code":"export function run(i) {\n  return eval(i);\n}\n"}')"
echo "$js" | grep -q '"source":"eslint"' || fail "no ESLint finding for the JavaScript sample: $js"
echo "  JavaScript review finds an ESLint finding"

py="$(curl -fsS -X POST "$BASE/review" -H 'Content-Type: application/json' \
  -d '{"filename":"app.py","language":"python","code":"import os\nos.system(cmd)\n"}')"
echo "$py" | grep -q '"source":"ruff"' || fail "no Ruff finding for the Python sample (is Ruff in the image?): $py"
echo "  Python review finds a Ruff finding"

[ "$(docker exec "$NAME" id -u)" != "0" ] || fail "the container runs as root"
echo "  runs as a normal user"

docker stop -t 30 "$NAME" >/dev/null
code="$(docker inspect -f '{{.State.ExitCode}}' "$NAME")"
[ "$code" = "0" ] || fail "the exit code after docker stop was $code, expected 0"
echo "  stops cleanly (exit code 0)"

echo "OK: the image works."