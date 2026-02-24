# Operations Runbook

## Ziel

Dieses Runbook beschreibt Standard-Operationen für den Live-Betrieb.

## Start/Stop

Entwicklung:

```bash
npm run dev
```

Container:

```bash
docker compose up -d
docker compose logs -f
docker compose down
```

## Basis-Monitoring

Prüfen:

- API erreichbar (`/health`)
- Login funktioniert
- Sessionliste lädt
- Audio kann gestartet/gestoppt werden
- Listener empfangen Audio

## Incident-Triage

1. Scope bestimmen (alle Sessions vs. einzelne Session)
2. Logs sammeln (API/Media/Web)
3. Auth/Session-Kontext prüfen
4. Netzwerk/RTC-Port-Verfügbarkeit prüfen
5. Entscheiden: Hotfix, Rollback oder Restart

## Häufige Betriebsaktionen

- Session/Broadcast neu initialisieren
- verwaiste Broadcast-Owner prüfen
- Debug-Mode togglen (nicht in prod)
- Passwortreset für Admin über gesicherten Prozess

## Backup/Recovery

- regelmäßige DB-Backups
- getestete Restore-Prozedur
- dokumentierte Recovery-Zeitziele (RTO/RPO)

## Änderungsmanagement

- keine direkten Prod-Edits ohne Ticket
- jede Änderung mit Testnachweis
- post-deploy Smoke-Test Pflicht


