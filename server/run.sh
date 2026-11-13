#!/usr/bin/env bash
# Starts the Stratego LAN server. Run it from anywhere:   ./run.sh      (PORT=9000 ./run.sh to change the port)
# It installs the dependencies on first use and rebuilds the browser client whenever the sources are newer.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required (https://nodejs.org)." >&2
  exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Node.js 20 or newer is required; this is $(node -v)." >&2
  exit 1
fi

[ -d node_modules ] || npm install --no-audit --no-fund

# rebuild when the client is missing or any source (including the shared game code) is newer than it
if [ ! -f public/index.html ] || [ -n "$(find client src ../single/web/src -type f -newer public/index.html -print -quit)" ]; then
  npm run build
fi

exec node src/index.js
