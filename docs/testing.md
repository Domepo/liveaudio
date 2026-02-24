# Testing

## Testpyramide

- Unit-Tests: Logiknah und schnell
- Integrations-/API-Tests: Auth, Rechte, Flüsse
- E2E-Tests: zentrale User-Journeys
- Last-/Soak-Tests: Realtime-Stabilität

## Wichtige Befehle

```bash
npm run test:unit
npm run test:e2e
npm run test:load:socket:smoke
npm run test:webrtc:smoke
```

## Fokusbereiche

- Login-Flow inkl. Rate-Limit
- Rollen und Berechtigungen
- Session- und Channel-Verwaltung
- Broadcast-Start/Stop/Reconnect
- Listener-Verhalten bei Verbindungsabbrüchen

## Security-relevante Regressionen

Pflicht bei Auth-Änderungen:

- unautorisierter Zugriff wird abgewiesen
- Passwortwechsel invalidiert alte Session
- Bootstrap-Login erzwingt Passwortwechsel

## Testumgebung

Hilfsskripte:

```bash
npm run test:env:reset
npm run test:env:health
```

## CI-Empfehlung

- Unit-Tests immer
- E2E zumindest auf main/release branches
- Lasttests als nightly/weekly Jobs

## Fehleranalyse bei Testausfall

1. reproduzierbar lokal?
2. nur flakey oder deterministisch?
3. Infrastrukturproblem vs. Logikproblem?
4. minimalen failing case isolieren


