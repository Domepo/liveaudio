# Oracle SSH Usage

## Standard-Ziel

- User/Host: `ubuntu@130.61.29.150`
- Key: `.ssh/oracle.key` (Fallback: `~/.ssh/oracle.key`)
- Direktbefehl: `ssh -i .ssh/oracle.key ubuntu@130.61.29.150`

## Compose-Dateien Auf Dem Server

- `/home/freeserver/compose/stack-portainer/docker-compose.yml`
- `/home/freeserver/compose/stack-apps/docker-compose.yml`

## Repositories Auf Dem Server

- `/home/freeserver/compose/stack-apps/github/liveaudio`
- `/home/freeserver/compose/stack-apps/github/SecureNotes1`
- `/home/freeserver/compose/stack-apps/github/PhoenixUI`

## Typische Checks

- `hostname`
- `uptime`
- `df -h`
- `free -m`
- `sudo systemctl status <service>`
- `sed -n '1,260p' /home/freeserver/compose/stack-apps/docker-compose.yml`
- `ls -la /home/freeserver/compose/stack-apps/github`

## Fehlerbehebung

- `Permission denied (publickey)`: Key-Pfad und Rechte (`chmod 600`) pruefen.
- `Connection timed out`: Security List/NSG/Firewall und Port 22 pruefen.
- `Host key verification failed`: `~/.ssh/known_hosts` fuer den Host aktualisieren.
