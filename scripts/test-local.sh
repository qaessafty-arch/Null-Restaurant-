#!/usr/bin/env bash
# Build once, start a production server on a throwaway database, run the API suite, stop the server.
# Usage: scripts/test-local.sh [--no-build]
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-3100}"
WORK="$(mktemp -d)"
export DATABASE_PATH="$WORK/ci.db" UPLOAD_DIR="$WORK/uploads" ADMIN_USERNAME=admin ADMIN_PASSWORD='Admin#12345' INSECURE_COOKIES=1 BASE="http://localhost:$PORT"
if lsof -ti tcp:"$PORT" >/dev/null 2>&1 || (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
  echo "port $PORT is busy; stop the other server first" >&2; exit 1
fi
[ "${1:-}" = "--no-build" ] || DATABASE_PATH="$WORK/build.db" pnpm -s build >/dev/null
pnpm -s exec next start -p "$PORT" >"$WORK/server.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true; wait $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "$BASE/api/menu" >/dev/null && break; sleep 0.5; done
node --test --test-concurrency=1 tests/*.test.mjs || { echo "--- server log ($WORK/server.log) ---"; tail -40 "$WORK/server.log"; exit 1; }
