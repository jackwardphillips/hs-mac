# Startup health notifications

The `com.jack.startup-health` user LaunchAgent runs after automatic login. It
waits up to five minutes for Docker Desktop, then reconciles the always-on
Homepage, Portainer, and BlueMap web Compose services with locally available
images. Minecraft remains under the separate availability-window scheduler.
The health inventory asks that scheduler for its expected state, so an
intentionally stopped Minecraft container is shown as `scheduled-off` and is
excluded from the expected-container and healthcheck denominators.

The check discovers all Compose projects under `compose/*/compose.yaml` and
inspects every expected service container, including stopped containers. A
stopped container with a configured healthcheck counts as unhealthy rather
than disappearing from the healthcheck denominator. Healthy recovery must be
observed in two consecutive samples before the notification is sent. Failure
notifications include each service's observed state.

The watcher stores the last observed macOS version in the Git-ignored
`data/startup-health/` directory. A version change produces an explicit update
notification; other boots produce a restart notification. Discord delivery
failure exits unsuccessfully so `launchd` retries after its throttle interval.

It reuses the owner-only webhook at `power-monitor/discord-webhook.url`.

Install or refresh the LaunchAgent:

```sh
cp config/launchd/com.jack.startup-health.plist \
  ~/Library/LaunchAgents/com.jack.startup-health.plist
launchctl bootout "gui/$(id -u)/com.jack.startup-health" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" \
  ~/Library/LaunchAgents/com.jack.startup-health.plist
```

Inspect its state and log:

```sh
launchctl print "gui/$(id -u)/com.jack.startup-health"
tail -n 50 data/startup-health/launchd.log
```

## Scheduled-job alerts

`com.jack.scheduled-job-alerts` checks existing status records every five
minutes. It alerts only when Twitcher is failed or overdue, BlueMap is failed
or stale, the Minecraft scheduler exits unsuccessfully, three distinct macOS
update checks fail consecutively, or Personal Observatory crosses one of its
health thresholds.

Observatory alerts require either two consecutive API/database health-check
failures, three consecutive USGS collection failures, or more than 20 minutes
without a successful USGS collection. This produces an API alert after roughly
10 minutes and tolerates up to two transient source/network failures. Each
problem generates one alert and one recovery; routine successful runs remain
silent. Runtime state and logs are stored under the Git-ignored
`data/scheduled-job-alerts/` directory.

Install or refresh it with the same LaunchAgent pattern:

```sh
cp config/launchd/com.jack.scheduled-job-alerts.plist \
  ~/Library/LaunchAgents/com.jack.scheduled-job-alerts.plist
launchctl bootout "gui/$(id -u)/com.jack.scheduled-job-alerts" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" \
  ~/Library/LaunchAgents/com.jack.scheduled-job-alerts.plist
```
