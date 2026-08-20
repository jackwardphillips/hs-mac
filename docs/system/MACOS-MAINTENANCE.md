# macOS maintenance

The host runs `com.jack.weekly-macos-maintenance` every Saturday at 3:00 AM in
the host's `America/New_York` timezone. The job runs as a system LaunchDaemon,
so macOS can authorize installation without storing an administrator password.

## Behavior

The job:

1. Skips the run if the Mac is not connected to AC power.
2. Checks for Apple software updates.
3. Installs recommended updates with `softwareupdate --install --recommended
   --restart --force` when an update is pending.
4. Reboots weekly when no update is pending. If the update command itself
   restarts the Mac, the final reboot command is not reached. If the update
   remains pending after the install command returns, the job records an error
   and does not issue a generic reboot.

The maintenance log is stored at
`data/system-update/maintenance.log`. The existing startup-health LaunchAgent
reports whether Docker, Tailscale, and the monitored services recover after the
restart.

## Install or refresh

From the server repository:

```sh
sudo install -d -o root -g wheel -m 0755 /usr/local/libexec
sudo install -o root -g wheel -m 0755 \
  scripts/system/weekly-macos-maintenance.sh \
  /usr/local/libexec/jack-weekly-macos-maintenance
sudo install -o root -g wheel -m 0644 \
  config/launchd/com.jack.weekly-macos-maintenance.plist \
  /Library/LaunchDaemons/com.jack.weekly-macos-maintenance.plist
sudo launchctl bootout system/com.jack.weekly-macos-maintenance 2>/dev/null || true
sudo launchctl bootstrap system \
  /Library/LaunchDaemons/com.jack.weekly-macos-maintenance.plist
sudo launchctl print system/com.jack.weekly-macos-maintenance
```

The repository copy and root-owned installed copy must remain in sync after
changes. The repository copy can be tested without updating or rebooting:

```sh
MAINTENANCE_DRY_RUN=1 scripts/system/weekly-macos-maintenance.sh
tail -n 20 data/system-update/maintenance.log
```

To disable the schedule without deleting its files:

```sh
sudo launchctl bootout system/com.jack.weekly-macos-maintenance
```
