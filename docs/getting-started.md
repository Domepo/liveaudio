# Getting Started

## Quickstart für Hosting (empfohlen)

Wenn du LiveAudio nur hosten willst, musst du nichts selbst bauen.
Repository: `https://github.com/Domepo/liveaudio` (Branch `main`)

### 1. Voraussetzungen

- Docker
- Docker Compose Plugin (`docker compose`)

### 2. Container pullen

```bash
docker pull ghcr.io/domepo/liveaudio:latest
```

### 3. Minimales Compose-File erstellen

Erstelle eine Datei `docker-compose.hosting.yml` mit diesem Inhalt:

```yaml
services:
  postgres:
    image: ${POSTGRES_IMAGE:-timescale/timescaledb:2.17.2-pg16}
    restart: unless-stopped
    environment:
      POSTGRES_DB: livevoice
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: change-me-postgres
    volumes:
      - pgdata:/var/lib/postgresql/data

  app:
    image: ghcr.io/domepo/liveaudio:latest
    restart: unless-stopped
    depends_on:
      - postgres
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_PORT: 5432
      POSTGRES_USER: postgres
      POSTGRES_DB: livevoice
      POSTGRES_PASSWORD: change-me-postgres
      DATABASE_URL: postgresql://postgres:change-me-postgres@postgres:5432/livevoice?schema=public
      API_PORT: 3001
      API_HOST: 0.0.0.0
      MEDIA_PORT: 4000
      MEDIA_LISTEN_IP: 0.0.0.0
      MEDIA_ANNOUNCED_IP: <DEINE_OEFFENTLICHE_IP_ODER_DOMAIN_IP>
      RTC_MIN_PORT: 40000
      RTC_MAX_PORT: 42000
      JWT_SECRET: <MINDESTENS_32_ZEICHEN>
      JWT_ISSUER: liveaudio-api
      TRUST_PROXY: true
      MEDIA_BASE_URL: http://127.0.0.1:4000
      MEDIA_INTERNAL_TOKEN: <LANGER_RANDOM_TOKEN_MIN_24>
      ADMIN_LOGIN_NAME: admin
      ADMIN_PASSWORD_HASH: <BCRYPT_HASH>
    ports:
      - "5173:5173"
      - "3001:3001"
      - "40000-42000:40000-42000/udp"

volumes:
  pgdata:
```

### 4. Starten

```bash
docker compose -f docker-compose.hosting.yml up -d
```

Das App-Image wird als Multi-Arch-Image (`linux/amd64` und `linux/arm64`) in GHCR veröffentlicht.

### 5. Aufruf

- Web UI: `http://<SERVER-IP>:5173`
- API Health: `http://<SERVER-IP>:3001/health`

## Welche Ports müssen offen sein?

Pflicht:

- `5173/tcp` (Weboberfläche)
- `40000-42000/udp` (WebRTC Audio)

Optional/Intern:

- `3001/tcp` (API, nur wenn extern benötigt; sonst intern lassen)
- `5432/tcp` (Postgres, nur intern im Docker-Netz, nicht öffentlich freigeben)

## Wichtig für Sicherheit

- `JWT_SECRET` und `MEDIA_INTERNAL_TOKEN` immer mit starken eigenen Werten setzen.
- `ADMIN_PASSWORD_HASH` nie als Klartext, sondern als bcrypt Hash.
- `TRUST_PROXY=true` nur setzen, wenn du wirklich hinter einem Reverse Proxy läufst.

## Erstlogin

Wenn noch kein Admin in der Datenbank existiert, kann der Bootstrap-Login verwendet werden.  
Danach wird sofort ein Passwortwechsel erzwungen.

## Lokale Entwicklung (nur falls du selbst entwickeln willst)

### Voraussetzungen

- Node.js 20+
- npm 10+
- Git

### Setup

```bash
git clone https://github.com/Domepo/liveaudio.git
cd liveaudio
npm install
npm run db:init
npm run prisma:generate
npm run dev
```

### Doku lokal starten

```bash
npm run docs:dev
```

Build:

```bash
npm run docs:build
```

