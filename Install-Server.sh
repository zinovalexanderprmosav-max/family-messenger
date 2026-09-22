#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required."
  exit 1
fi

if [ ! -f .env.server ]; then
  DEFAULT_HOST=""
  if command -v curl >/dev/null 2>&1; then
    PUBLIC_IP="$(curl -fsS https://api.ipify.org 2>/dev/null || true)"
    case "$PUBLIC_IP" in
      *.*.*.*) DEFAULT_HOST="$(printf '%s' "$PUBLIC_IP" | tr '.' '-').sslip.io" ;;
    esac
  fi

  echo ""
  echo "Family Messenger server setup"
  echo ""
  if [ -n "$DEFAULT_HOST" ]; then
    printf "Public HTTPS host [%s]: " "$DEFAULT_HOST"
  else
    printf "Public HTTPS host (for example family.example.com): "
  fi
  read -r HOST_INPUT
  PUBLIC_HOST="${HOST_INPUT:-$DEFAULT_HOST}"

  if [ -z "$PUBLIC_HOST" ]; then
    echo "A public host is required."
    exit 1
  fi

  if command -v openssl >/dev/null 2>&1; then
    POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  else
    POSTGRES_PASSWORD="$(date +%s)$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  fi

  umask 077
  {
    echo "PUBLIC_HOST=$PUBLIC_HOST"
    echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
  } > .env.server
  echo "Created .env.server"
fi

. ./.env.server

echo ""
echo "Starting Family Messenger..."
docker compose --env-file .env.server -f docker-compose.server.yml up -d --build

echo "Waiting for HTTPS..."
i=0
while [ "$i" -lt 90 ]; do
  if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 5 "https://$PUBLIC_HOST/health" 2>/dev/null | grep -q '"status":"ok"'; then
    echo ""
    echo "READY"
    echo "Family Messenger: https://$PUBLIC_HOST"
    echo "Health: https://$PUBLIC_HOST/health"
    echo "Server now runs independently of the PC."
    exit 0
  fi
  i=$((i+1))
  sleep 2
done

echo "Containers are running, but HTTPS is not reachable yet."
echo "Check public DNS/IP and incoming TCP ports 80 and 443."
docker compose --env-file .env.server -f docker-compose.server.yml logs --tail=100 gateway app
exit 1
