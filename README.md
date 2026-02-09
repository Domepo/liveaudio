# LiveVoice Alternative (MVP)

Audio-only Echtzeit-System mit MediaSoup, Node.js/TypeScript, Prisma und Svelte + Tailwind.

## Enthalten

- `apps/api`: REST + Socket.IO Signaling + Join/PIN Validierung
- `apps/media`: MediaSoup Worker/Router/Transport/Producer/Consumer
- `apps/web`: Broadcaster/Listener Webinterface (Tailwind)
- `prisma/schema.prisma`: **lokales Dev-Schema (SQLite)**
- `prisma/schema.postgres.prisma`: **Postgres-Schema für Docker/Deployment**
- `docker-compose.yml`: lokales Container-Setup mit Postgres

## Schnellstart lokal (ohne Docker)

```bash
npm install
npm run dev
```

Startet automatisch:

- Prisma Client Generate + SQLite DB-Init (`prisma/dev.db`)
- Media: `http://localhost:4000/health`
- API: `http://localhost:3000/health`
- Web: `http://localhost:5173`

## Nutzung im lokalen Netzwerk (Handy)

1. Beide Geräte müssen im selben WLAN/LAN sein.
2. App auf dem Rechner mit `npm run dev` starten.
3. Rechner-IP ermitteln (z. B. `192.168.x.x`).
4. Am Handy öffnen: `http://<RECHNER-IP>:5173`
5. Join-Link/QR wird jetzt mit derselben Host-IP erzeugt (nicht mehr nur `localhost`).

Hinweis:
- API läuft auf Port `3000`
- Media läuft auf Port `4000` (plus UDP `40000-40100` für WebRTC)
- Firewall muss diese lokalen Verbindungen erlauben.

## Docker-Start (Postgres)

```bash
npm run dev:docker
```

## Testing

Das Projekt hat jetzt drei Testebenen:

- API Integration/Unit: `vitest` + `supertest`
- Web Component Tests: `vitest` + `@testing-library/svelte`
- E2E Smoke: `playwright`

Schnellbefehle:

```bash
# API + Web Tests
npm run test:unit

# E2E (baut API+Web vorher automatisch)
npm run test:e2e

# Alles
npm test
```

Hinweise:

- Vor den Tests sollte die lokale SQLite-DB initialisiert sein:
  - `npm run db:init`
- Für E2E muss einmalig ein Browser installiert werden:
  - `npx playwright install chromium`

## MVP-Flow

1. Im Bereich **Admin** mit Name + Passwort anmelden (Default lokal: `admin` / `test`, sofern kein Admin-Benutzer angelegt wurde).
2. Channel erstellen.
3. Join-Link + PIN erzeugen (inkl. QR-Code).
4. Broadcast starten (Mic-Freigabe).
5. Im Tab **Listener** Token + PIN validieren.
6. Kanal wählen und Audio starten.

## Hinweise

- Token werden gehasht gespeichert (`sha256`), PIN gehasht (`bcrypt`).
- Basic Rate-Limit gegen PIN-Bruteforce ist aktiv.
- UI liest `token` und `pin` aus Query-Params (Join-Link kompatibel).
