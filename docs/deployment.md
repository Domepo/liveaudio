# Deployment

## Schnellster Weg: Prebuilt Container aus GHCR

Image pullen:

```bash
docker pull ghcr.io/domepo/liveaudio:latest
```

Dann mit Compose starten (siehe [Getting Started](/getting-started) für copy-paste `docker-compose.hosting.yml`).

## Deployment-Optionen

1. Prebuilt GHCR Container + Compose (empfohlen)
2. Lokales Docker Compose mit Build
3. Split-Deployment (Web/API/Media getrennt)

## Docker Compose mit lokalem Build

```bash
docker compose up --build
```

Voraussetzungen:

- korrekte ENV-Werte
- geöffnete Ports für API/Web/Media

## Port- und Firewall-Matrix

Extern öffnen:

- `5173/tcp`: Web-UI
- `40000-42000/udp`: WebRTC Audio Transport

Nur intern (nicht public):

- `3001/tcp`: API (kann intern bleiben, wenn nur Web genutzt wird)
- `5432/tcp`: Postgres

Empfehlung:

- API und DB über Security Group/Firewall nur für interne Netze erlauben.
- Web nur über HTTPS Reverse Proxy exponieren.

## GHCR Container Publishing

Es existiert ein Workflow:

- `.github/workflows/docker-publish.yml`

Trigger:

- Push auf `main`
- Tag `v*.*.*`
- manueller Trigger

Build-Strategie:

- Docker Buildx mit QEMU
- Multi-Arch Push fuer `linux/amd64` und `linux/arm64`

Image:

- `ghcr.io/domepo/liveaudio:latest`
- `ghcr.io/domepo/liveaudio:<tag>`

## Produktions-Checkliste

- starke Secrets gesetzt (`JWT_SECRET`, `MEDIA_INTERNAL_TOKEN`)
- `NODE_ENV=production`
- HTTPS/TLS vor App geschaltet
- `TRUST_PROXY` korrekt konfiguriert
- Monitoring/Logs vorhanden
- Rollback-Strategie dokumentiert

## Datenbank für Produktion

Postgres Schema verwenden:

```bash
npm run prisma:generate:postgres
npm run prisma:push:postgres
```

`DATABASE_URL` muss auf die produktive Instanz zeigen.

## Rollback

Empfohlen:

- immutable Image-Tags je Release
- DB-Änderungen vorher sichern
- Release Notes mit Breaking Changes dokumentieren

