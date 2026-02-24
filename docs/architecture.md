# Architektur

## Systemüberblick

LiveAudio besteht aus drei Hauptkomponenten:

- `web` (Svelte): Admin- und Listener-Oberfläche
- `api` (Express + Prisma): Auth, Session-Management, Administration, Analytics
- `media` (Realtime): Audio-/WebRTC-Layer

Die API ist das Steuerzentrum für Auth, Rechte, Sessiondaten und betriebliche Konfiguration.

## Auth- und Rollenmodell

Rollen:

- `ADMIN`
- `BROADCASTER`
- `VIEWER`

Kernpunkte:

- Admin-Session über signiertes Cookie (`admin_session`)
- Session-Versionierung invalidiert alte Tokens bei Logout/Passwortwechsel
- erzwungener Passwortwechsel (`mustChangePassword`) für Bootstrap-Login

## Session-Lebenszyklus

1. Session wird erstellt
2. Kanäle werden angelegt/verwaltet
3. Broadcaster startet Audio
4. Listener verbinden sich auf aktive Kanäle
5. Session kann beendet oder archiviert werden

## Datenmodell (vereinfacht)

Wichtige Tabellen:

- `User`
- `Session`
- `Channel`
- `SessionUserAccess`
- `JoinToken`
- `AccessLog`
- `AnalyticsPoint`
- `AppConfig`

## Konfigurationsspeicher

`AppConfig` wird für runtime-konfigurierbare Werte verwendet, z. B.:

- Passwort-/Login-Fallback-Werte
- Branding
- Debug-Flag
- Auth-Session-Version

## Realtime-Flüsse

- Socket-Verbindungen werden rollen- und sessionbezogen verwaltet
- Broadcast-Ownership verhindert parallelen Konfliktbetrieb
- Listener-Statistiken werden kontinuierlich aktualisiert

## Designprinzipien

- Auth vor Funktionalität: jede sensible Route hat klare Schutzschicht
- defensive Defaults: Prod-Start verweigert bei unsicherer Security-Konfiguration
- Betriebsfähigkeit: Monitoring-/Testhooks für Last- und Stabilitätsprüfung

