#!/usr/bin/env bash
set -euo pipefail

ORACLE_HOST="${ORACLE_HOST:-freeserver}"
LOCAL_SOURCE_DIR="${LOCAL_SOURCE_DIR:-/Users/dominik/Documents/liveaudio}"
REMOTE_REPO_DIR="${REMOTE_REPO_DIR:-/home/freeserver/compose/stack-apps/github/liveaudio}"
REMOTE_COMPOSE_DIR="${REMOTE_COMPOSE_DIR:-/home/freeserver/compose/stack-apps}"

if ! command -v rsync >/dev/null 2>&1; then
  echo "[deploy] rsync is required but not installed." >&2
  exit 1
fi

if [ ! -d "$LOCAL_SOURCE_DIR" ]; then
  echo "[deploy] local source directory does not exist: $LOCAL_SOURCE_DIR" >&2
  exit 1
fi

echo "[deploy] host=$ORACLE_HOST"
echo "[deploy] local_source=$LOCAL_SOURCE_DIR"
echo "[deploy] repo_dir=$REMOTE_REPO_DIR"
echo "[deploy] compose_dir=$REMOTE_COMPOSE_DIR"

ssh "$ORACLE_HOST" "mkdir -p '$REMOTE_REPO_DIR'"

echo "[deploy] syncing files to server..."
rsync -az --delete \
  --exclude ".git/" \
  --exclude "node_modules/" \
  --exclude "test-results/" \
  --exclude "playwright-report/" \
  --exclude "*.log" \
  "$LOCAL_SOURCE_DIR"/ "$ORACLE_HOST":"$REMOTE_REPO_DIR"/

ssh "$ORACLE_HOST" bash -s -- "$REMOTE_COMPOSE_DIR" <<'REMOTE_SCRIPT'
set -euo pipefail
REMOTE_COMPOSE_DIR="$1"
echo "[remote] compose up --build"
cd "$REMOTE_COMPOSE_DIR"
sudo docker compose up -d --build
sudo docker compose ps
REMOTE_SCRIPT

echo "[deploy] done"
