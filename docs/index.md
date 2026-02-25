# LiveAudio Dokumentation

Diese VitePress-Dokumentation beschreibt den gesamten technischen Rahmen von LiveAudio:

- lokale Entwicklung
- Architektur und Datenmodell
- Konfiguration und Security-Hardening
- Deployment und Betrieb
- Teststrategie und Fehlersuche

## Demo

![LiveAudio Demo](/assets/readme_gif.gif)

## Zielgruppe

Die Inhalte richten sich an:

- Entwickler:innen, die Features bauen oder refactoren
- DevOps/Platform, die Deployments und Runtime betreiben
- QA, die funktionale und nicht-funktionale Tests ausführen
- Projektverantwortliche, die Risiko und Betriebsfähigkeit beurteilen

## Schnellstart (Hosting in wenigen Minuten)

1. `docker pull ghcr.io/domepo/liveaudio:latest`
2. Compose-Quickstart aus [Getting Started](/getting-started) kopieren
3. Ports freigeben: `5173/tcp`, `40000-42000/udp`
4. Starten: `docker compose -f docker-compose.hosting.yml up -d`

## Repository

- GitHub: `https://github.com/Domepo/liveaudio`
- Main-Branch: `https://github.com/Domepo/liveaudio/tree/main`

## Repository-Struktur

```text
apps/
  api/        Express + Prisma + Auth + Analytics
  media/      Echtzeit-Medienpipeline (WebRTC/Audio)
  web/        Svelte Admin/Listener Frontend
docker/       Dockerfiles (api/web/media/app)
prisma/       Prisma Schemas (sqlite + postgres)
scripts/      Betriebs- und Init-Skripte
docs/         VitePress-Doku + Planungsdokumente
```

## Dokumentationsprinzipien

- Diese Doku ist betrieblich ausgerichtet: jedes Kapitel soll handlungsfähig sein.
- Security-Annahmen und Tradeoffs werden explizit gemacht.
- Befehle sind so dokumentiert, dass sie direkt im Repo-Root funktionieren.

## Wartung der Doku

- Neue Features erhalten mindestens:
  - Update in `architecture.md` (Verantwortung/Fluss)
  - Update in `configuration.md` (neue ENV-Variablen)
  - Update in `testing.md` (Regression/Szenarien)
- Deployment- oder Security-relevante Änderungen müssen zusätzlich `deployment.md` und `security.md` aktualisieren.
