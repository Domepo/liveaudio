# API Übersicht

## Basis

- Prefix: `/api`
- Auth: Cookie-basiert für Admin-Bereich
- Formate: JSON Request/Response

## Auth-Routen (Auszug)

- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/me`
- `POST /api/admin/change-password`

Hinweis:

- Beim Bootstrap-Admin kann `mustChangePassword=true` zurückkommen.
- Bis Passwortwechsel bleiben sensible Admin-APIs gesperrt.

## Benutzerverwaltung

- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:userId`
- `DELETE /api/admin/users/:userId`
- `GET /api/admin/roles`

## Sessionverwaltung (Auszug)

- `GET /api/admin/sessions`
- `POST /api/admin/sessions`
- `GET /api/admin/sessions/:sessionId`
- `PATCH /api/admin/sessions/:sessionId`

## Analytics (Auszug)

- `GET /api/admin/analytics/v2/compare`
- weitere Endpunkte je nach Dashboard-Tab

## Fehlerbehandlung

- 400: Payload/Validierung ungültig
- 401: nicht authentifiziert
- 403: authentifiziert aber nicht berechtigt
- 404: Ressource nicht vorhanden/kein Zugriff
- 429: Login-Rate-Limit

## Sicherheitsaspekte

- Login-Limiter aktiv
- Session-Version für Token-Invalidierung
- Rollenprüfung pro Route
- Passwortwechsel-Zwang bei Bootstrap-Accounts

