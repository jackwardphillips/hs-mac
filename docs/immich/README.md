# Immich

Immich is a tailnet-only photo and video library. It is currently running on
the internal disk because the photo SSD is not connected yet.

## Access

- Tailnet URL: `https://mac.example:2283`
- Local listener: `localhost:2283`
- Compose file: `compose/immich/compose.yaml`
- Photo library mount point: `photos/`
- Database: `data/immich/postgres/`

The first account created in the web UI becomes the administrator. Tailscale
Serve publishes the localhost-bound listener to the tailnet only; Funnel is
not enabled.

## Operations

```sh
docker compose --env-file compose/immich/.env.immich -f compose/immich/compose.yaml config
docker compose --env-file compose/immich/.env.immich -f compose/immich/compose.yaml ps
docker compose --env-file compose/immich/.env.immich -f compose/immich/compose.yaml logs --tail=100
```

The environment file contains the database password and is ignored by Git.
Do not replace `DB_PASSWORD` after the first boot. The database is on the
internal disk and should be backed up before upgrades or storage migration.

## Attaching the photo SSD later

Do not mount the SSD over `photos/` until the current library is empty or has
been deliberately migrated. A mount hides files already present in that
directory while the SSD is attached. Stop Immich, confirm the SSD mount path,
copy or move the library deliberately, update `UPLOAD_LOCATION` if needed,
then validate with `docker compose config` and start the stack again.

## Updates

Review the upstream Immich release notes and current official Compose file,
then update `IMMICH_VERSION` and any changed image digests together. Preserve
the database directory and photo library during upgrades.
