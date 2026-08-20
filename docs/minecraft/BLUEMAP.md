# Briancraft II BlueMap

BlueMap renders an interactive 3D map of the Briancraft II Overworld. The map
is available only on the Tailscale tailnet at:

```text
http://surface.example:8100
```

The map intentionally excludes the Nether, End, Aether, caves, and distant
untouched Chunky-pregenerated terrain. Before each render, a host-side tool
reads chunk `InhabitedTime` without modifying the world, adds a one-chunk
buffer, fills terrain enclosed by the resulting outer boundary, and generates
a BlueMap render mask. The buffer softens exploration edges; the enclosed fill
removes interior holes without closing gaps that remain connected to the
unexplored exterior. Inhabited time records player proximity rather than only
chunks players physically entered.

Chunky-pregenerated chunks inside the mask may not contain saved lighting
data. BlueMap is configured to render those chunks anyway so they do not
appear as holes. Such chunks are rendered fully lit and may include cave
geometry that BlueMap cannot identify without skylight data, increasing render
time and storage and potentially exposing caves at terrain edges.

BlueMap scans the server's Fabric mod JARs while rendering. Most modded blocks
use their packaged models and textures; blocks whose resources are generated
only at runtime may render imperfectly. BlueMap does not render mobs or other
entities.

## Architecture

`/home/jack/services/bluemap/compose.yaml` plus `compose.surface.yaml` define
two services on Surface:

- `bluemap` is the lightweight, always-on web viewer. Port 8100 is published
  only on Surface's Tailscale address.
- `bluemap-render` is a one-shot renderer with read-only access to the
  Minecraft server tree. It is limited to one render thread, two CPUs, and
  a 1 GiB Java heap inside a 2 GiB container limit. Java exits immediately if
  it exhausts the heap so a failed render cannot remain wedged indefinitely.

Configuration is versioned under `bluemap/config`. Generated render data,
cached resources, web assets, progress state, and logs are Git-ignored under
`bluemap/data` and `bluemap/web`.

The `bluemap-render.timer` systemd timer runs an incremental render at
12:10 AM, after Minecraft's scheduled midnight shutdown, only when at least
one player joined during the preceding local calendar day. Successful joins
are recorded by the existing Discord join watcher. Manual runs remain
unconditional, and `--force` overrides the activity check. The wrapper refuses
to render while Minecraft is running, uses a PID-owned lock to prevent
overlapping renders, and atomically regenerates the buffered mask first. The
Minecraft scheduler treats a live BlueMap lock as a temporary service hold.
The render wrapper removes its own lock and immediately reconciles the normal
Minecraft schedule on every exit; stale locks whose owner process is gone are
cleared by the scheduler. Administrative holds remain independent. Its status
record retains the completion time and duration of the last actual successful
render when a later scheduled check is intentionally skipped.

Unchanged region files are served from a local metadata cache so nightly scans
only decompress regions Minecraft changed. A failed or empty scan aborts the
render. The wrapper atomically records render state in
`bluemap/status/status.json`.
The Homepage health helper exposes the last actual successful render's age and
duration while scheduled-check health still distinguishes active, successful,
intentionally skipped, failed, and older-than-36-hour stale checks independently
of the BlueMap web container's health.

## Operations

Show viewer status and logs:

```sh
cd /home/jack/services/bluemap
docker compose -f compose.yaml -f compose.surface.yaml ps
docker compose -f compose.yaml -f compose.surface.yaml logs --tail=100 bluemap
```

Run an incremental render while Minecraft is stopped:

```sh
/home/jack/services/minecraft/scripts/render-bluemap.sh
tail -f /home/jack/bluemap/render.log
```

Force BlueMap to revisit every chunk in the selected shape after a render
setting changes:

```sh
/home/jack/services/minecraft/scripts/render-bluemap.sh --force
```

Start or update the viewer:

```sh
docker compose -f compose.yaml -f compose.surface.yaml config
docker compose -f compose.yaml -f compose.surface.yaml up -d bluemap
```

The initial render can take substantially longer than nightly incremental
renders. Render output size can be checked with:

```sh
du -sh bluemap/data bluemap/web
```
