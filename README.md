# LiveAudio

Produktionsnahes Audio-Streaming-System für Live-Broadcasts mit WebRTC.

[Dokumentation](https://domepo.github.io/liveaudio/) • [Repository](https://github.com/Domepo/liveaudio) • [Main Branch](https://github.com/Domepo/liveaudio/tree/main)

## Warum LiveAudio?

- Audio-only Echtzeit-Streaming mit niedriger Latenz
- Admin- und Listener-UI im Browser
- Token/PIN-basierter Join-Flow inklusive QR-Link
- Docker-fähiges Deployment mit Postgres
- Klare Trennung von API, Media-Pipeline und Web-Frontend

## Stack

- Backend: Node.js, TypeScript, Express, Socket.IO
- Realtime: mediasoup (WebRTC)
- Frontend: Svelte
- Datenbank: Prisma (`SQLite` lokal, `Postgres` für Deployment)
- Tests: Vitest, Supertest, Playwright

## Projektstruktur

```text
apps/
  api/      REST + Auth + Signaling + Business Logic
  media/    mediasoup Worker/Router/Transports
  web/      Admin- und Listener-Frontend
prisma/
  schema.prisma            SQLite (lokal)
  schema.postgres.prisma   Postgres (Deployment)
docs/       VitePress-Dokumentation
docker/     Docker-Build-Kontext
```

## Schnellstart lokal

Voraussetzungen:
- Node.js 20+
- npm 10+

```bash
npm install
npm run dev
```

Startet automatisch:
- Web: `http://localhost:5173`
- API Health: `http://localhost:3001/health`
- Media Health: `http://localhost:4000/health`

## Schnellstart Hosting (Docker)

```bash
docker pull ghcr.io/domepo/liveaudio:latest
docker compose -f docker-compose.hosting.yml up -d
```

Eine vollständige, kopierbare Hosting-Konfiguration findest du in der Doku:
- [Getting Started](./docs/getting-started.md)
- [Deployment](./docs/deployment.md)

## Nutzung im LAN (Handy)

1. Rechner und Handy ins gleiche WLAN/LAN.
2. App lokal starten: `npm run dev`
3. Rechner-IP ermitteln (z. B. `192.168.x.x`)
4. Im Handy-Browser öffnen: `http://<RECHNER-IP>:5173`

Benötigte Ports:
- `5173/tcp` (Web)
- `3001/tcp` (API)
- `4000/tcp` (Media Health/API intern)
- `40000-42000/udp` (WebRTC Audio)

## Tests

```bash
# Unit + Integration (API/Web)
npm run test:unit

# E2E Smoke
npm run test:e2e

# Komplett
npm test
```

Hinweis für E2E:
```bash
npx playwright install chromium
```

## Sicherheitsaspekte

- Tokens werden gehasht gespeichert (`sha256`)
- PINs werden gehasht gespeichert (`bcrypt`)
- Basis-Rate-Limit gegen PIN-Bruteforce ist aktiv
- Bootstrap-Admin muss Passwortwechsel erzwingen (`mustChangePassword`)

Details:
- [Security](./docs/security.md)
- [Configuration](./docs/configuration.md)
- [Troubleshooting](./docs/troubleshooting.md)

## Nützliche Doku-Links

- [Dokumentations-Start](./docs/index.md)
- [Architektur](./docs/architecture.md)
- [API Übersicht](./docs/api-overview.md)
- [Operations Runbook](./docs/operations.md)
- [Testing](./docs/testing.md)

