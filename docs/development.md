# Entwicklung

## Standard-Workflow

1. Branch erstellen
2. Änderung implementieren
3. Unit- und ggf. E2E-Tests ausführen
4. Dokumentation aktualisieren
5. Commit/Pull Request

## Relevante npm-Skripte

```bash
npm run dev
npm run test:unit
npm run test:e2e
npm run prisma:generate
npm run db:init
```

## API entwickeln

- Einstieg: `apps/api/src/main.ts`
- Routenregistrierung: `apps/api/src/app/register-runtime.ts`
- Auth- und Rollenlogik: `apps/api/src/services/admin-core.ts`
- Validierung: `apps/api/src/http/schemas.ts`

Empfehlung:

- neue Request/Response-Felder zuerst in Schema und Tests abbilden
- danach Route und Client anpassen

## Web entwickeln

- Zustand: `apps/web/src/stores/app.ts`
- Controller: `apps/web/src/controllers/**`
- UI: `apps/web/src/components/**`

Empfehlung:

- State-Änderungen zentral im Store typisieren
- API-Fehler immer in User-Statusfeld oder klarer UI-Meldung zeigen

## Media entwickeln

- Fokus auf stabile Echtzeitpfade
- bei Änderungen an Transport/Socket immer Last-/Reconnect-Verhalten prüfen

## Datenbankänderungen

Wenn Prisma Schema geändert wurde:

```bash
npm run prisma:generate
npm run db:init
```

Bei Postgres-Deployment zusätzlich:

```bash
npm run prisma:generate:postgres
npm run prisma:push:postgres
```

## Coding-Richtlinien (kurz)

- kleine, testbare Funktionen
- Fehlertexte für API eindeutig halten
- Security-Defaults nicht aufweichen
- Dokumentation für betriebliche Änderungen immer mitziehen

