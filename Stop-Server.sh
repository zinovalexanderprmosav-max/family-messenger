#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT"
docker compose --env-file .env.server -f docker-compose.server.yml down
echo "Family Messenger stopped."
