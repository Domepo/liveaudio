#!/usr/bin/env bash
set -euo pipefail

ORACLE_HOST="${ORACLE_HOST:-freeserver}"
LOCAL_SOURCE_DIR="${LOCAL_SOURCE_DIR:-/Users/dominik/Documents/liveaudio}"
REMOTE_COMPOSE_DIR="${REMOTE_COMPOSE_DIR:-/home/freeserver/compose/stack-apps}"
TARGET_STACK="${TARGET_STACK:-auto}"
FORCE_FULL_COMPOSE_UP="${FORCE_FULL_COMPOSE_UP:-0}"

if ! command -v rsync >/dev/null 2>&1; then
  echo "[deploy] rsync is required but not installed." >&2
  exit 1
fi

if [ ! -d "$LOCAL_SOURCE_DIR" ]; then
  echo "[deploy] local source directory does not exist: $LOCAL_SOURCE_DIR" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "[deploy] git is required but not installed." >&2
  exit 1
fi

detect_branch() {
  git -C "$LOCAL_SOURCE_DIR" rev-parse --abbrev-ref HEAD
}

map_target_from_branch() {
  local branch="$1"
  case "$branch" in
    main|master)
      echo "prod"
      ;;
    dev|develop)
      echo "dev"
      ;;
    *)
      echo ""
      ;;
  esac
}

CURRENT_BRANCH="$(detect_branch)"

if [ "$TARGET_STACK" = "auto" ]; then
  TARGET_STACK="$(map_target_from_branch "$CURRENT_BRANCH")"
fi

if [ -z "$TARGET_STACK" ]; then
  echo "[deploy] unsupported branch '$CURRENT_BRANCH'." >&2
  echo "[deploy] allowed branch mapping: main/master -> prod, dev/develop -> dev." >&2
  echo "[deploy] you can override via TARGET_STACK=prod or TARGET_STACK=dev." >&2
  exit 1
fi

case "$TARGET_STACK" in
  prod)
    REMOTE_REPO_DIR="${REMOTE_REPO_DIR:-/home/freeserver/compose/stack-apps/github/liveaudio}"
    COMPOSE_SERVICES="livevoice-web livevoice-api livevoice-media"
    ;;
  dev)
    REMOTE_REPO_DIR="${REMOTE_REPO_DIR:-/home/freeserver/compose/stack-apps/github/liveaudio-dev}"
    COMPOSE_SERVICES="livevoice-dev-web livevoice-dev-api livevoice-dev-media"
    ;;
  *)
    echo "[deploy] invalid TARGET_STACK='$TARGET_STACK'. Use prod, dev, or auto." >&2
    exit 1
    ;;
esac

echo "[deploy] host=$ORACLE_HOST"
echo "[deploy] local_source=$LOCAL_SOURCE_DIR"
echo "[deploy] branch=$CURRENT_BRANCH"
echo "[deploy] target_stack=$TARGET_STACK"
echo "[deploy] repo_dir=$REMOTE_REPO_DIR"
echo "[deploy] compose_dir=$REMOTE_COMPOSE_DIR"
echo "[deploy] services=$COMPOSE_SERVICES"

ssh "$ORACLE_HOST" "mkdir -p '$REMOTE_REPO_DIR'"

echo "[deploy] syncing files to server..."
rsync -az --delete \
  --exclude ".git/" \
  --exclude "node_modules/" \
  --exclude "test-results/" \
  --exclude "playwright-report/" \
  --exclude "*.log" \
  "$LOCAL_SOURCE_DIR"/ "$ORACLE_HOST":"$REMOTE_REPO_DIR"/

ssh "$ORACLE_HOST" bash -s -- "$REMOTE_COMPOSE_DIR" "$COMPOSE_SERVICES" "$FORCE_FULL_COMPOSE_UP" <<'REMOTE_SCRIPT'
set -euo pipefail
REMOTE_COMPOSE_DIR="$1"
COMPOSE_SERVICES="$2"
FORCE_FULL_COMPOSE_UP="$3"
cd "$REMOTE_COMPOSE_DIR"
if [ "$FORCE_FULL_COMPOSE_UP" = "1" ]; then
  echo "[remote] compose up --build (all services)"
  sudo docker compose up -d --build
else
  echo "[remote] compose up --build ${COMPOSE_SERVICES}"
  sudo docker compose up -d --build ${COMPOSE_SERVICES}
fi
sudo docker compose ps
REMOTE_SCRIPT

echo "[deploy] done"
