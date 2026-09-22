#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT"
if [ ! -f .env.server ]; then
  echo ".env.server is missing. Run ./Install-Server.sh first."
  exit 1
fi
git pull --ff-only
docker compose --env-file .env.server -f docker-compose.server.yml up -d --build
docker image prune -f
echo "Family Messenger updated."
