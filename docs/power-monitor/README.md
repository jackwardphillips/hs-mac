# Power monitoring

The host power monitor checks macOS power status every 20 seconds and sends a
Discord notification when the server switches to battery or returns to AC.
It starts silently when initially installed on AC power, but immediately warns
if it starts while the host is already on battery.

Delivery failures are retried without recording the transition. The Discord
webhook is read from an owner-only, Git-ignored runtime file and is never put in
the process list or operational log. Discord mentions are disabled.

## Configure and test

Create a dedicated Discord webhook. Store its URL locally without adding it to
Git:

```zsh
mkdir -p power-monitor
chmod 700 power-monitor
read -rs 'webhook_url?Discord webhook URL: '
printf '\n'
printf '%s\n' "${webhook_url}" > power-monitor/discord-webhook.url
unset webhook_url
chmod 600 power-monitor/discord-webhook.url
scripts/power-monitor/notify-discord-power.sh --test
```

Delete and replace a webhook immediately if its URL is exposed in chat, logs,
shell history, or a committed file.

## Install the LaunchAgent

```sh
cp config/launchd/com.jack.power-monitor.plist \
  ~/Library/LaunchAgents/com.jack.power-monitor.plist
launchctl bootout "gui/$(id -u)/com.jack.power-monitor" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" \
  ~/Library/LaunchAgents/com.jack.power-monitor.plist
```

Verify the agent and inspect its log:

```sh
launchctl print "gui/$(id -u)/com.jack.power-monitor"
tail -n 50 power-monitor/power-monitor.log
```

To exercise the real transition path, unplug AC long enough to receive the
battery alert, then reconnect it and confirm the recovery alert. This depends
on working network access; during a building outage the router and modem also
need battery backup for the alert to leave the server.
