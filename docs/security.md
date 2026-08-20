# Securing Playlarr

Playlarr handles API keys and OAuth sessions. Never commit `.env`, `.secrets/`, `.data/`, OAuth sessions, API keys,
generated reports, or container data. The supplied ignore files already exclude them.

The web UI supports a single-user password with signed, expiring sessions and login throttling. Passwords are stored as
Argon2 hashes. Authentication is enabled by default.

Installations fully protected by a trusted SSO gateway such as Authelia can skip or disable Playlarr authorization
during setup or from Settings. CSRF protection remains enabled in both modes. Never disable authorization when Playlarr
is directly reachable around the gateway.

Playlarr does not terminate TLS. Keep it on a trusted network or place it behind a trusted HTTPS reverse proxy.
`PLAYLARR_AUTH_ENABLED=false` is appropriate only for isolated development or a deployment whose gateway protects every
route. The session signing secret and password hash live in the protected SQLite database under `/config`.
