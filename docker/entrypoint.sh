#!/bin/sh
set -eu
: "${SQLITE_PATH:=/data/analysis.sqlite}"
export SQLITE_PATH
mkdir -p "$(dirname "$SQLITE_PATH")"
if [ "${1:-}" != "--locked" ]; then
  # Kernel lock survives PID namespace changes and is released on container death.
  exec flock --no-fork --nonblock "${SQLITE_PATH}.container.lock" "$0" --locked "$@"
fi
shift
# Only the exclusive volume owner can remove a PID lock from a dead container.
rm -f "${SQLITE_PATH}.worker.lock"
exec node scripts/start-local.cjs "$@"
