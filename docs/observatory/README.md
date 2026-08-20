# Personal Observatory operations

The production deployment runs on `surface` at
`/home/jack/services/the-observatory`. The independently versioned application
source remains under `/Users/jack/Server/apps/the-observatory` on the Mac; copy
an intentional release to Surface before rebuilding it.

The Surface Compose project runs PostgreSQL/PostGIS, the FastAPI application,
the built frontend, and the dedicated collector scheduler. The API is exposed
only on Surface's Tailscale address at `http://surface.example:8000`; PostgreSQL
is bound to Surface loopback and is not exposed to the tailnet or LAN.

## Routine inspection

From Surface:

```sh
cd /home/jack/services/the-observatory
docker compose -f docker-compose.yml -f compose.surface.yaml ps
docker compose -f docker-compose.yml -f compose.surface.yaml logs --tail=100 api scheduler postgres
curl -fsS http://surface.example:8000/health
curl -fsS http://surface.example:8000/collectors/status
```

After intentionally copying an application release to Surface, rebuild and
recreate only the application processes:

```sh
docker compose -f docker-compose.yml -f compose.surface.yaml build api scheduler
docker compose -f docker-compose.yml -f compose.surface.yaml up -d api scheduler
```

Do not remove the Postgres volume. Take a verified logical database backup
before upgrades, migrations, or other disruptive work.

## Monitoring and Homepage

Uptime Kuma on Surface checks the Tailscale-only API. The Mac's
`com.jack.scheduled-job-alerts` job also queries Surface every five minutes and
writes a non-sensitive summary to `data/observatory/health.json`; Homepage's
internal `poller-health` helper reads that file through a read-only mount.

Check the same signals from the Mac with:

```sh
curl -fsS http://surface.example:8000/health
curl -fsS http://surface.example:8000/collectors/status
launchctl print "gui/$(id -u)/com.jack.scheduled-job-alerts"
tail -n 50 /Users/jack/Server/data/scheduled-job-alerts/launchd.log
```

## Rollback copy on Mac

The old Mac `com.jack.observatory-api` and
`com.jack.observatory-scheduler` launchd jobs are disabled, and the original
PostgreSQL container is stopped. The application tree, Docker volume, and final
migration dump are deliberately retained. Never start the Mac scheduler while
the Surface scheduler is active, because both would collect into independent
databases. A rollback must stop Surface first, restore or start the Mac database,
and then explicitly re-enable and bootstrap the Mac launchd jobs.
