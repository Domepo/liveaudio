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
npm run test:webrtc:background
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

## Hintergrundwiedergabe

`npm run test:webrtc:background` startet ausschließlich isolierte Testdienste
auf Loopback, einen eigenen mediasoup-Worker und zwei Chromium-Clients. Es nutzt
synthetische Sitzungsdaten und einen erzeugten Ton; eine laufende Installation
oder deren Datenbank wird nicht angesprochen. Voraussetzung ist ein installiertes
Chromium (`npx playwright install chromium --only-shell`). Optional kann
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` auf ein vorhandenes Chromium zeigen.

Der Test prüft tatsächlich empfangene Audiopakete und Audioenergie während eines
65 Sekunden langen Ausfalls ausschließlich der Steuerverbindung. Danach prüft er
Wiederverbindung, bewusstes Stoppen sowie das Freigeben der Medienverbindung beim
Sendeende. Ohne Steuerverbindung wird ein geschlossener Client über den
ICE-Consent-Timeout von 30 Sekunden und eine Erholungsfrist von 15 Sekunden
aufgeräumt. Ein weiterhin verbundenes, aktives Audiomedium bleibt erhalten.

Ergänzende Unit-Tests prüfen vorübergehende Statistikfehler im Hintergrund,
echte Empfangsfehler im Vordergrund, Eigentümergrenzen und ICE-Erholung.
Diese Tests ersetzen keinen Standby-Test am echten Handy: Für eine Geräteabnahme
Android/iOS, Browser-Version, Netzwerk und Energiesparmodus festhalten und mehrere
Minuten mit gesperrtem Bildschirm hören. Dabei zusätzlich bewusstes Stoppen und
Fortsetzen nach dem Entsperren prüfen. Die Media Session API stellt
Sperrbildschirm-Bedienelemente bereit, garantiert jedoch keine Hintergrundausführung.

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


