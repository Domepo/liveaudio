---
name: oracle-ssh-access
description: Stelle SSH-Verbindungen zu einem Oracle-Cloud-Ubuntu-Server per Key her und fuehre Remote-Befehle oder Basis-Administration aus. Nutze dieses Skill bei Anfragen wie "verbinde dich per SSH", "fuehre einen Befehl auf meinem Oracle-Server aus" oder "pruefe Serverstatus" fuer den Host ubuntu@130.61.29.150 mit dem Schluessel .ssh/oracle.key.
---

# Oracle SSH Access

## Quick Start

- Interaktive Anmeldung:
  - `bash scripts/connect_oracle.sh`
- Einzelnen Remote-Befehl ausfuehren:
  - `bash scripts/connect_oracle.sh "hostname && uptime"`
- Direkte SSH-Alternative:
  - `ssh -i .ssh/oracle.key ubuntu@130.61.29.150`

## Workflow

1. Pruefe, ob der Key vorhanden ist und korrekte Rechte hat:
   - `ls -l .ssh/oracle.key`
   - Falls noetig: `chmod 600 .ssh/oracle.key`
2. Stelle Verbindung ueber `scripts/connect_oracle.sh` her.
3. Fuehre nur explizit angefragte Aenderungen aus.
4. Dokumentiere ausgefuehrte Befehle und Ergebnisse knapp.

## Konfiguration

- `ORACLE_SSH_KEY` (optional): Ueberschreibt den Key-Pfad.
- `ORACLE_SSH_HOST` (optional): Ueberschreibt Zielhost inklusive User.

Beispiele:
- `ORACLE_SSH_KEY=.ssh/anderer.key bash scripts/connect_oracle.sh`
- `ORACLE_SSH_HOST=ubuntu@203.0.113.10 bash scripts/connect_oracle.sh "uname -a"`

## Compose Und Repos Auf Dem Oracle-Server

- Compose-Dateien:
  - `/home/freeserver/compose/stack-portainer/docker-compose.yml`
  - `/home/freeserver/compose/stack-apps/docker-compose.yml`
- GitHub-Repo-Checkouts (laut Compose-Build-Kontext):
  - `/home/freeserver/compose/stack-apps/github/liveaudio`
  - `/home/freeserver/compose/stack-apps/github/SecureNotes1`
  - `/home/freeserver/compose/stack-apps/github/PhoenixUI`

Befehle:
- `bash scripts/connect_oracle.sh "sed -n '1,260p' /home/freeserver/compose/stack-apps/docker-compose.yml"`
- `bash scripts/connect_oracle.sh "ls -la /home/freeserver/compose/stack-apps/github"`

## Sicherheit

- Fuer destructive Aktionen (z. B. `rm -rf`, Firewall-Aenderungen, Reboots) erst explizite Bestaetigung einholen.
- Keys niemals in Logs, Commits oder Antworten ausgeben.
- Bei Verbindungsproblemen zuerst Netzwerk/Port 22/Key-Pfad pruefen.
