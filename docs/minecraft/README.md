# Briancraft II Minecraft server

The Briancraft II server runs Minecraft 1.21.1 with Fabric on `surface` from
`/home/jack/services/minecraft`. Generated server files and world data are
stored persistently in `/home/jack/minecraft/briancraft-ii`.
The source CurseForge export is stored at
`minecraft/modpacks/Briancraft-II-Server-1.0.zip` and mounted read-only. The
runtime tree and source ZIP are accessible only to the owning macOS account.

## Access

The server listens on TCP port 25565. It is available on the LAN at:

```text
minecraft.example:25565
```

Router forwarding is not configured. The server is not publicly reachable
unless TCP port 25565 is forwarded to Surface.

Mojang online authentication and whitelist enforcement are enabled. An empty
whitelist denies all players. The current whitelist contains `jackad00bs`,
`BungoPrime`, `limkon123`, `BriShoota`, and `Ohioboy9`. Minecraft canonicalized
the requested `OhioBoy9` capitalization to `Ohioboy9`.

The server permits at most eight concurrent players.

The multiplayer server list displays `Now featuring ducks!` with the custom
duck icon stored at `minecraft/briancraft-ii/server-icon.png`. Its original
source is preserved at `minecraft/server-icon-source.png`.

The server also includes The Aether 1.5.11 and owo-lib 0.12.15.4. Every player
must install matching versions of both mods in their client pack; Aether
bundles its required Accessories dependency.

## Availability and idle behavior

The server is scheduled in the host's `America/New_York` timezone:

- Monday through Friday: 5:00 PM to midnight.
- Saturday and Sunday: 7:30 AM to midnight.

The `minecraft-reconcile.timer` systemd timer runs
`/home/jack/services/minecraft/scripts/reconcile-minecraft-schedule.sh` every
five minutes, after boot, and at schedule boundaries. It corrects the container
state after missed events or Docker restarts. Its runtime log and health status
are `/home/jack/minecraft/schedule.log` and `schedule-status.json`.

To keep Minecraft stopped regardless of the schedule, create the administrative
hold file and run the reconciler:

```sh
touch /home/jack/minecraft/.schedule-disabled
/home/jack/services/minecraft/scripts/reconcile-minecraft-schedule.sh
```

To resume the normal schedule:

```sh
rm /home/jack/minecraft/.schedule-disabled
/home/jack/services/minecraft/scripts/reconcile-minecraft-schedule.sh
```

For supervised maintenance that must continue outside normal hours, create
`minecraft/.schedule-force-enabled` and run the reconciler. Remove this file
immediately after maintenance. The administrative stop hold takes precedence
if both override files exist.

During available hours, the Java process automatically pauses after ten
minutes with no connected players and wakes when a player connects. Auto-pause
does not release the committed Java heap; the scheduled stop does.

Homepage intentionally uses only Docker container monitoring for Minecraft.
Polling the Minecraft status widget would repeatedly wake the paused server.

## Discord join notifications

The Minecraft schedule reconciler loads the
`minecraft-join-watcher.service` continuously supervises
`/home/jack/services/minecraft/scripts/notify-discord-minecraft-join.sh`.
The watcher looks for successful player joins and sends only those events to a
Discord channel. Failed login and whitelist attempts do not generate
notifications.

The administrative hold disables both Minecraft and its join watcher. The
force-running override enables both outside the normal schedule.

The watcher records its byte position in
`minecraft/discord-join-watcher.state`. This lets it resume after a watcher
restart, follow Minecraft log replacement, and retry a notification after a
temporary delivery failure without intentionally skipping the join event.
Its operational log is `minecraft/discord-join-watcher.log`.

The Discord webhook is a credential. Store the URL as the only line in the
file `/home/jack/minecraft/discord-join-webhook.url`, then restrict and test
it:

```sh
chmod 600 /home/jack/minecraft/discord-join-webhook.url
/home/jack/services/minecraft/scripts/notify-discord-minecraft-join.sh --test
```

The watcher never writes the webhook URL to its operational log. If the URL is
ever exposed, delete the webhook in Discord, create a replacement, update the
credential file, and restart `minecraft-join-watcher.service`.

Inspect the installed watcher and schedule units with:

```sh
systemctl status minecraft-join-watcher.service
systemctl status minecraft-reconcile.timer
systemctl status minecraft-reconcile.service
```

Check the watcher:

```sh
systemctl status minecraft-join-watcher.service
tail -n 50 /home/jack/minecraft/discord-join-watcher.log
```

The watcher remains active outside the availability window and simply waits
for new successful join lines.

## Operations

Show status:

```sh
cd /home/jack/services/minecraft
docker compose -f compose.yaml -f compose.surface.yaml ps
```

Follow logs:

```sh
docker compose -f compose.yaml -f compose.surface.yaml logs -f
```

Start or apply a reviewed configuration change:

```sh
docker compose -f compose.yaml -f compose.surface.yaml config
docker compose -f compose.yaml -f compose.surface.yaml up -d
```

Stop the server cleanly:

```sh
docker compose -f compose.yaml -f compose.surface.yaml stop
```

Add a player to the whitelist:

```sh
docker exec minecraft rcon-cli whitelist add MINECRAFT_USERNAME
```

Remove a player:

```sh
docker exec minecraft rcon-cli whitelist remove MINECRAFT_USERNAME
```

Show the current whitelist:

```sh
docker exec minecraft rcon-cli whitelist list
```

## Memory

Surface has 15 GiB of RAM. Minecraft starts with a 2 GiB Java heap and can grow
to 6 GiB. The isolated migration rehearsal maintained 20 TPS with ample tick
budget, but monitor the older mobile CPU during multiplayer exploration and new
terrain generation.

The server view distance is 24 chunks and the simulation distance is 12
chunks. These are relatively demanding settings for this host and should be
re-evaluated if behind-tick warnings become frequent.

Do not run chunk pregeneration on this host without supervised memory and
temperature monitoring.

## Current world

The active world uses seed `-6370818114994274834`. Chunky pre-generated:

- Overworld: complete circular radius of 5,000 blocks.
- Nether: complete circular radius of 1,500 blocks.
- Aether: 14,633 chunks, or 23.23% of the requested 2,000-block radius.

The Aether task was cancelled cleanly after generation slowed to roughly one
chunk per second or less. The generated chunks remain valid; the cancelled
Chunky task itself cannot be resumed. No world border is configured.

## Public access checklist

Before configuring router forwarding:

1. Add every intended player to the whitelist.
2. Confirm `online-mode=true`, `white-list=true`, and
   `enforce-whitelist=true` in the effective server properties.
3. Forward only TCP port 25565 from the router to Surface's reserved LAN IP.
4. Test from a network outside the home.
5. Do not expose RCON or any additional Minecraft management port.
