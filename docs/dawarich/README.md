# Dawarich

Dawarich is a tailnet-only self-hosted location-history service running on
`surface`.

## Access

- URL: `https://surface.example/` (replace with the private tailnet hostname)
- HTTPS: Tailnet-only Tailscale Serve proxy; Funnel is disabled
- Backend listener: Surface's Tailscale address at port 3002
- Deployment directory: `/home/jack/services/dawarich`

## Operations

Run these commands on Surface:

```sh
cd /home/jack/services/dawarich
docker compose --env-file .env.dawarich \
  -f compose.yaml -f compose.surface.yaml ps
docker compose --env-file .env.dawarich \
  -f compose.yaml -f compose.surface.yaml logs --tail=100
tailscale serve status
```

Tailscale Serve terminates HTTPS and proxies `/` to the configured Surface
tailnet address on port 3002. To remove only this HTTPS proxy, run
`tailscale serve --https=443 off` on Surface.

The environment file contains the database password and Rails secret and must
remain owner-only. Do not replace it after first boot: changing those values can
make the existing database or encrypted application data inaccessible.

The stack uses named Docker volumes for PostgreSQL, Redis shared state, imports,
public assets, and application storage. Take a verified PostgreSQL dump and
archive the non-database volumes before upgrades or migrations. Never remove the
volumes as part of routine Compose operations.

## Updates

Review the upstream Dawarich release notes, update both `freikin/dawarich` image
references in `compose.yaml`, validate the combined Compose model, and recreate
the stack while preserving all volumes.

## Rollback copy on Mac

The original Mac containers and Docker volumes are stopped and retained. A final
database dump and archives of all non-database volumes are stored under
`/Users/jack/Server/backups/dawarich/20260820-153839`. Do not start the Mac stack
while Surface Dawarich is active. A rollback must stop Surface first, restart the
preserved Mac stack, and restore the former Homepage and Uptime Kuma targets.
