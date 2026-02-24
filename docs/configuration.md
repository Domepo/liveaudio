# Konfiguration

## API Environment

Wichtige Variablen:

- `API_PORT` (Default `3001`)
- `API_HOST` (Default `0.0.0.0`)
- `DATABASE_URL` (bei Postgres)
- `JWT_SECRET`
- `JWT_ISSUER` (Default `liveaudio-api`)
- `ADMIN_LOGIN_NAME` (Bootstrap/Fallback)
- `ADMIN_PASSWORD_HASH` (bcrypt Fallback)
- `ADMIN_LOGIN_MAX_ATTEMPTS` (Rate-Limit Login)
- `ADMIN_SESSION_TTL_HOURS`
- `ADMIN_SESSION_REFRESH_THRESHOLD_MINUTES`
- `ADMIN_WS_TOKEN_TTL_MINUTES`
- `TRUST_PROXY`
- `MEDIA_BASE_URL`
- `MEDIA_INTERNAL_TOKEN`

## Security-Pflichtwerte in Produktion

In `NODE_ENV=production` muss der Start fehlschlagen, wenn:

- `JWT_SECRET` fehlt oder zu schwach ist
- `ADMIN_LOGIN_NAME` fehlt
- `ADMIN_PASSWORD_HASH` fehlt
- `MEDIA_INTERNAL_TOKEN` fehlt/zu schwach ist

## Passwortregeln

Passwörter für Admin-Change und User-Management:

- mindestens 10 Zeichen
- mindestens 1 Kleinbuchstabe
- mindestens 1 Grossbuchstabe
- mindestens 1 Zahl
- mindestens 1 Sonderzeichen

## Web Environment

- `VITE_API_URL` (optional)
- `VITE_WS_URL` (optional)
- `VITE_ALLOWED_HOSTS`

## Media Environment

- `MEDIA_PORT`
- `MEDIA_HOST`
- `MEDIA_LISTEN_IP`
- `MEDIA_ANNOUNCED_IP`
- `RTC_MIN_PORT`
- `RTC_MAX_PORT`
- `MEDIA_INTERNAL_TOKEN` (muss identisch zur API sein)

## Beispiel

Siehe `.env.example` im Repo-Root für ein praktisches Start-Template.

