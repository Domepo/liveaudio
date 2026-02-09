---
name: oracle-liveaudio-deploy
description: Deploye LiveAudio auf den Oracle-Server per SSH ohne GitHub-Zugriff auf dem Server. Nutze dieses Skill bei Anfragen wie "deploye liveaudio", "kopiere den aktuellen code auf den server", "sync per scp/rsync" oder "starte stack-apps mit docker compose neu" fuer die Zielpfade /home/freeserver/compose/stack-apps/github/liveaudio und /home/freeserver/compose/stack-apps.
---

# Oracle LiveAudio Deploy

## Overview

Fuehre einen reproduzierbaren Deploy auf dem Oracle-Server aus: lokalen Code per SSH-Dateiuebertragung (`rsync`, aehnlich zu `scp`) in das Zielverzeichnis kopieren und danach im Compose-Verzeichnis `sudo docker compose up -d --build` starten.

## Workflow

1. Pruefe lokal, ob dein Workspace den gewuenschten Stand hat.
2. Fuehre den Deploy ueber `scripts/deploy_liveaudio.sh` aus.
3. Pruefe danach den Service-Status (`docker compose ps`).
4. Melde kurz die wichtigsten Ergebnisse (Sync, Build, laufende Container).

## Commands

- Standard-Deploy:
  - `bash scripts/deploy_liveaudio.sh`
- Deploy mit anderem lokalen Quellordner:
  - `LOCAL_SOURCE_DIR=/pfad/zum/liveaudio bash scripts/deploy_liveaudio.sh`
- Deploy auf anderem SSH-Host-Alias:
  - `ORACLE_HOST=my-oracle bash scripts/deploy_liveaudio.sh`

## Required Paths On Server

- Repository-Ziel: `/home/freeserver/compose/stack-apps/github/liveaudio`
- Compose-Verzeichnis: `/home/freeserver/compose/stack-apps`

Das Script erstellt das Zielverzeichnis bei Bedarf und synchronisiert den kompletten lokalen Projektstand nach remote (mit Excludes fuer `.git`, `node_modules`, `test-results`, `playwright-report`).

## Safety Rules

- Keine Loeschbefehle ausserhalb des Ziel-Repo-Pfads.
- Bei Fehlern sofort abbrechen und den genauen Fehler ausgeben.

## Resources

### scripts/

- `scripts/deploy_liveaudio.sh`: Fuehrt SSH-Deploy, Datei-Sync (rsync) und Compose-Build/Up aus.

### references/

- `references/paths.md`: Enthaltene Zielpfade und Variablen fuer den Deploy.
