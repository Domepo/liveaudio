# Troubleshooting

## API startet nicht

Prüfen:

- `.env` gesetzt?
- Port bereits belegt?
- `JWT_SECRET` / `MEDIA_INTERNAL_TOKEN` in Prod valide?
- Prisma Client generiert?

Befehle:

```bash
npm run prisma:generate
npm run db:init
```

## Login funktioniert nicht

Mögliche Ursachen:

- falsche Credentials
- Login-Rate-Limit aktiv (429)
- Bootstrap-Flow bereits verbraucht
- Passwortwechsel erzwungen und noch nicht abgeschlossen

## "Authentication required" trotz Login

Prüfen:

- Cookie wird gesetzt?
- Domain/Origin/CORS korrekt?
- Session wurde durch Logout/Passwortwechsel invalidiert?

## "Password change required"

Bedeutung:

- Account ist im Zustand `mustChangePassword=true`
- nur `/api/admin/me`, `/api/admin/logout`, `/api/admin/change-password` erlaubt

Lösung:

- Passwort sofort über Admin-UI ändern
- danach neu einloggen

## WebRTC/Audio-Probleme

Prüfen:

- Netzwerkports (`RTC_MIN_PORT..RTC_MAX_PORT`)
- HTTPS/Browser-Berechtigungen
- Media-Service erreichbar
- Signaling-Logs auf Disconnect/Auth errors

## Datenbankschema passt nicht

Symptome:

- Fehler wie "column does not exist"

Lösung lokal:

```bash
npm run db:init
npm run prisma:generate
```

Lösung Postgres:

```bash
npm run prisma:generate:postgres
npm run prisma:push:postgres
```

## Build/CI-Fehler bei Docs

Prüfen:

- `vitepress` installiert?
- `docs/.vitepress/config.ts` syntaktisch korrekt?
- alle Sidebar-Links zeigen auf vorhandene Dateien?

