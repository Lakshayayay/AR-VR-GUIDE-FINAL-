# ArGuide pilot deployment

**Private networks only.** ArGuide has no sign-in. Anyone who can reach it can act as any person, view their records or set up the first admin. Keep the app and its backend off the public internet.

This reference setup runs Next.js and one Python process behind a single HTTPS app address, with coturn for restrictive networks. Calls and drawings live in the Python process and are lost on restart.

## Prerequisites

- A Linux host with Node.js 24, Python 3.12 or newer, `uv`, Caddy, coturn and SQLite. The service examples expect the project at `/opt/arguide`, `npm` at `/usr/bin/npm`, and an `arguide` system user. Adjust these paths for the host.
- Use a coturn version whose default minimum is TLS 1.2; check the installed version's configuration documentation before deployment. Current coturn defaults to TLS 1.2 and rejects the older `no-tlsv1` and `no-tlsv1_1` options.
- A persistent data directory owned by `arguide`, private DNS names for the app and relay, and TLS certificates trusted by the devices on the network.
- Allow TCP 80 and 443 for Caddy from the private network. For coturn, allow UDP and TCP 3478, TCP 5349 and the configured UDP relay range from the private network. For clients that only allow TLS on port 443, use a separate relay IP and configure coturn's TLS listener there.

## Prepare and start

1. Install from the committed lockfiles: in `backend/`, run `uv sync --frozen --no-dev`; in `web/`, run `npm ci` and `npm run build`. Build on a machine with the dependencies and fonts available. The running app serves its own assets.
2. Create `/etc/arguide.env`, readable only by the service user and administrator. Set `DATA_DIR` to a persistent directory and `ALLOWED_ORIGINS` to the exact private HTTPS app origin.
3. Set `ICE_SERVERS=[]` for a closed network, and configure `TURN_URLS`, `TURN_SHARED_SECRET` and `TURN_TTL_SECONDS` as shown in `backend/.env.example`. The shared secret must match coturn's private configuration. Do not put real values in the repository.
4. Adapt the files in `deploy/` to the host, set `ARGUIDE_DOMAIN` in Caddy's service environment, install the systemd units and reload systemd. Start the Python and web services, Caddy and coturn. Keep ports 3000 and 8000 private to the host.
5. Open the HTTPS app, create the first admin, and add technicians and experts through **People**.
6. Verify person selection, a call, annotations, a photo, recording consent and the report. In a separate call, force the browser's ICE transport policy to `relay` and check WebRTC statistics for a selected relay candidate. Test TCP/TLS with UDP blocked.

## Backup and recovery

Stop the API during a coordinated backup, copy the SQLite database and uploads from `DATA_DIR` together, then restart it. Store an encrypted copy of the backup and the service configuration securely. Restore both database and uploads together on a test host, confirm the file ownership, restart services and open an existing report. Keep the previous application release available so code can be rolled back independently of the data backup.

When an updated ArGuide needs new tables or columns, the API upgrades the database as it starts. For SQLite it first saves a copy beside it as `arguide.db.pre-<version>`. The copy holds the database only, not uploads, and does not replace backups. If `DATABASE_URL` points to another database, back it up before updating. Upgrades only add things, so the previous release can still run on an upgraded database. Run one API process.

Monitor service health, available disk space, certificate expiry and coturn allocation failures. Do not put session content, passwords or TURN secrets in logs. No actual hosting or relay has been provisioned by this document.
