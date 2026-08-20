# Jack's Home Server

A headless Apple Silicon MacBook running long-lived services with Docker
Desktop and Tailscale. The host timezone is `America/New_York`.

## Access

| Service | Address | Notes |
| --- | --- | --- |
| SSH | `ssh jack@jack-server` | Tailscale access |
| Homepage | `https://mac.example:3000` | Tailnet-only server dashboard |
| Beszel | `https://mac.example:8090` | Tailnet-only compact server monitoring trial |
| Netdata | `https://mac.example:19999` | Tailnet-only host resource monitoring |
| Portainer | `https://mac.example` | Tailnet-only; Funnel disabled |
| Dawarich | `https://mac.example:3002` | Tailnet-only location history |
| Immich | `https://mac.example:2283` | Tailnet-only photo library |
| Jellyfin | `http://<server LAN IP>:8096` | LAN-only media server |
| Twitcher | `https://twitcher-sigma.vercel.app` | Public application |
| Briancraft II | `<server LAN IP>:25565` | Whitelist-only Minecraft server |

## Running services

| Service | Definition | Behavior |
| --- | --- | --- |
| Homepage | `compose/homepage/compose.yaml` | Tailnet-only dashboard and health cards |
| Poller health | `compose/homepage/compose.yaml` | Internal-only health API |
| Beszel | `compose/beszel/compose.yaml` plus Homebrew agent | Compact host and Docker monitoring trial |
| Netdata | Homebrew service | Native macOS metrics; localhost and Tailscale only |
| Portainer | `compose/portainer/compose.yaml` | Bound to localhost and served by Tailscale |
| Jellyfin | Homebrew cask plus `config/launchd/com.jack.jellyfin.plist` | Native Apple Silicon service; LAN-only access |
| Briancraft II | `compose/minecraft/compose.yaml` | Fabric 1.21.1 modpack; persistent world data |
| Dawarich | `compose/dawarich/compose.yaml` | Self-hosted location history; persistent database and imports |
| Immich | `compose/immich/compose.yaml` | Local-only photo library; persistent internal database and library mount point |
| Twitcher poller | `scripts/twitcher/run-twitcher-poller.sh` | Scheduled one-shot ingestion container |

The Twitcher poller runs at midnight, 2:00 AM, and every two hours from
6:00 AM through 10:00 PM. See [docs/twitcher/README.md](docs/twitcher/README.md)
for logging, health, correlation, and rollback details.

The macOS update card is refreshed by a host check at login and every six
hours. It reports available updates but never installs them automatically.

## Common operations

Show running containers:

```sh
docker ps
```

Inspect a stack:

```sh
docker compose -f compose/homepage/compose.yaml ps
docker compose -f compose/portainer/compose.yaml ps
```

View logs:

```sh
docker compose -f compose/homepage/compose.yaml logs
docker compose -f compose/portainer/compose.yaml logs
```

Apply a reviewed Compose change:

```sh
docker compose -f compose/<service>/compose.yaml config
docker compose -f compose/<service>/compose.yaml up -d
```

Create a Portainer backup:

```sh
./scripts/portainer/backup-portainer.sh
```

See [docs/portainer/BACKUPS.md](docs/portainer/BACKUPS.md) before restoring.

Minecraft operations and access controls are documented in
[docs/minecraft/README.md](docs/minecraft/README.md).

Jellyfin installation, storage, upgrades, SSD migration, and recovery are
documented in [docs/jellyfin/README.md](docs/jellyfin/README.md).

## Layout

```text
apps/       Independently versioned application repositories
compose/    Docker Compose services and their configuration
data/       Runtime application data; excluded from Git
backups/    Local backups; excluded from Git
docs/       Service-organized operations documentation and changelogs
scripts/    Service-organized operational scripts
media/      Media library; excluded from Git
photos/     Photo library; excluded from Git
minecraft/  Minecraft data; excluded from Git
```

Git tracks configuration, scripts, and documentation—not secrets, databases,
logs, backups, or personal data. Review `AGENTS.md` before changing running
services.
