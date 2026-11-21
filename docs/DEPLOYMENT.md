# ArGuide pilot deployment

This is a single-site reference setup to review before provisioning a host. It runs Next.js and one Python process behind one HTTPS app address, with coturn for restrictive networks. It is not a multi-server setup: calls and drawings are kept in one Python process and are lost on restart.

## Prerequisites

- A Linux host with Node.js 24, Python 3.12 or newer, `uv`, Caddy, coturn and SQLite. The service examples expect the project at `/opt/arguide`, `npm` at `/usr/bin/npm`, and an `arguide` system user. Adjust these paths for the host.
- Use a coturn version whose default minimum is TLS 1.2; check the installed version's configuration documentation before deployment. Current coturn defaults to TLS 1.2 and rejects the older `no-tlsv1` and `no-tlsv1_1` options.
- A persistent data directory owned by `arguide`, a DNS name and TLS certificate for the app, and a DNS name and certificate for the relay. Caddy can provision a public app certificate; a closed network needs its own trusted certificate authority.
- Open TCP 80 and 443 for Caddy. Open UDP and TCP 3478, TCP 5349 and the configured UDP relay range for coturn. For networks that only allow TLS on port 443, use a separate relay IP and configure coturn's TLS listener there. DNS and firewall configuration are host-specific.

## Prepare and start

1. Install from the committed lockfiles: in `backend/`, run `uv sync --frozen --no-dev`; in `web/`, run `npm ci` and `npm run build`. Build on a machine with the dependencies and fonts available. The running app serves its own assets.
2. Create `/etc/arguide.env`, readable only by the service user and administrator. Set `DATA_DIR` to a persistent directory, `SECRET_KEY` to a newly generated long random value, `COOKIE_SECURE=true`, and `ALLOWED_ORIGINS` to the exact HTTPS app origin. Set `DEV_NO_LOGIN=false`.
3. Set `ICE_SERVERS=[]` for a closed network, and configure `TURN_URLS`, `TURN_SHARED_SECRET` and `TURN_TTL_SECONDS` as shown in `backend/.env.example`. The shared secret must match coturn's private configuration. Do not put real values in the repository.
4. Create the first admin using `backend/.venv/bin/python -m app.cli create-user`, supplying the password interactively. Add the technicians and experts through the People page.
5. Adapt the files in `deploy/` to the host, set `ARGUIDE_DOMAIN` in Caddy's service environment, install the systemd units and reload systemd. Start the Python and web services, Caddy and coturn. Keep ports 3000 and 8000 private to the host.
6. Open the HTTPS app and verify login, a call, annotations, photo, recording consent and report. In a separate call, force the browser's ICE transport policy to `relay` and inspect WebRTC statistics for a selected relay candidate. Test TCP/TLS with UDP blocked. A normal mobile-data call alone does not prove relay use.

## Backup and recovery

Stop the API during a coordinated backup, copy the SQLite database and uploads from `DATA_DIR` together, then restart it. Store an encrypted copy of the backup and the service configuration securely. Restore both database and uploads together on a test host, confirm the file ownership, restart services and open an existing report. Keep the previous application release available so code can be rolled back independently of the data backup.

Monitor service health, available disk space, certificate expiry and coturn allocation failures. Do not put session content, passwords or TURN secrets in logs. No actual hosting or relay has been provisioned by this document.
