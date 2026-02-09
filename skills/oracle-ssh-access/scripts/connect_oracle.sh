#!/usr/bin/env bash
set -euo pipefail

USER_HOST="${ORACLE_SSH_HOST:-ubuntu@130.61.29.150}"

if [[ -n "${ORACLE_SSH_KEY:-}" ]]; then
  KEY_PATH="$ORACLE_SSH_KEY"
elif [[ -f ".ssh/oracle.key" ]]; then
  KEY_PATH=".ssh/oracle.key"
else
  KEY_PATH="$HOME/.ssh/oracle.key"
fi

if [[ ! -f "$KEY_PATH" ]]; then
  echo "Key nicht gefunden: $KEY_PATH" >&2
  echo "Setze ORACLE_SSH_KEY oder lege den Key unter ~/.ssh/oracle.key ab." >&2
  exit 1
fi

# Erzwinge sichere Key-Rechte, falls moeglich.
chmod 600 "$KEY_PATH" 2>/dev/null || true

if [[ "$#" -gt 0 ]]; then
  ssh -o StrictHostKeyChecking=accept-new -i "$KEY_PATH" "$USER_HOST" "$@"
else
  ssh -o StrictHostKeyChecking=accept-new -i "$KEY_PATH" "$USER_HOST"
fi
