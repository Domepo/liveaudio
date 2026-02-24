# Security

## Leitlinien

- Least Privilege für Rollen und Tokens
- sichere Defaults in Produktion
- Nachvollziehbarkeit sicherheitsrelevanter Änderungen

## Auth-Sicherheit

- Cookie-basierte Admin-Session (`httpOnly`, `sameSite=lax`, `secure` in Prod)
- JWT mit Issuer-Prüfung
- Session-Versionierung verhindert Reuse alter Tokens
- Login-Rate-Limiting aktiv

## Bootstrap-Admin-Härtung

- Initiale Fallback-Credentials nur für den ersten Login
- danach sofortiger Passwortwechsel erzwungen
- bis dahin Zugriff auf sensitive Admin-APIs blockiert

## Passwortsicherheit

Richtlinie:

- mind. 10 Zeichen
- Gross/Klein/Zahl/Sonderzeichen

Speicherung:

- nur bcrypt Hashes
- nie Klartextpasswörter loggen

## Netzwerk und Transport

- TLS terminieren (Reverse Proxy/Ingress)
- `TRUST_PROXY` nur korrekt gesetzt
- interne Services durch Secrets absichern (`MEDIA_INTERNAL_TOKEN`)

## Betriebs-Hardening

- Secrets nie im Repo speichern
- regelmäßige Secret-Rotation
- Produktion mit minimalen Rechten starten
- Admin-Endpunkte absichern (Firewall/VPN/Zero-Trust)

## Sicherheits-Checkliste vor Release

- [ ] Security-Pflichtwerte für Prod gesetzt
- [ ] Login- und Rollenflüsse getestet
- [ ] Passwortwechsel und Session-Invalidierung getestet
- [ ] keine sensitiven Logs/Debugdaten aktiv
- [ ] Dokumentation aktualisiert



