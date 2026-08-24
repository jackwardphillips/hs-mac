# Immich

Immich is a tailnet-only photo and video library. Its photo library is stored
on the external `Media` volume; its PostgreSQL database remains on the internal
disk.

## Access

- Tailnet URL: `https://mac.example:2283`
- Local listener: `localhost:2283`
- Compose file: `compose/immich/compose.yaml`
- Photo library: `/Volumes/Media/libraries/immich`
- Database: `data/immich/postgres/`

The first account created in the web UI becomes the administrator. Tailscale
Serve publishes the localhost-bound listener to the tailnet only; Funnel is
not enabled.

## Operations

```sh
docker compose --env-file compose/immich/.env --env-file compose/immich/.env.immich -f compose/immich/compose.yaml config
docker compose --env-file compose/immich/.env --env-file compose/immich/.env.immich -f compose/immich/compose.yaml ps
docker compose --env-file compose/immich/.env --env-file compose/immich/.env.immich -f compose/immich/compose.yaml logs --tail=100
```

The environment file contains the database password and is ignored by Git.
Do not replace `DB_PASSWORD` after the first boot. The database is on the
internal disk and should be backed up before upgrades or storage migration.

## External photo storage

The `Media` volume must be mounted at `/Volumes/Media` before starting Immich.
The Compose bind uses `create_host_path: false`, so startup fails instead of
creating an internal fallback directory when the external path is absent.
The pre-migration `photos/` directory is retained temporarily as a rollback
copy and is not the live library.

## Updates

Review the upstream Immich release notes and current official Compose file,
then update `IMMICH_VERSION` and any changed image digests together. Preserve
the database directory and photo library during upgrades.
