#!/bin/zsh

set -euo pipefail
umask 077

server_root="${SERVER_ROOT:-/Users/jack/Server}"
log_dir="$server_root/data/system-update"
log_file="$log_dir/maintenance.log"

mkdir -p "$log_dir"
exec >>"$log_file" 2>&1

log() {
  print -r -- "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"
}

if [[ "${MAINTENANCE_DRY_RUN:-0}" == "1" ]]; then
  log "DRY RUN: would inspect power, install recommended macOS updates, and reboot"
  exit 0
fi

if (( EUID != 0 )); then
  log "ERROR must run as root"
  exit 77
fi

power_source="$(/usr/bin/pmset -g ps 2>&1 || true)"
if [[ "$power_source" != *"AC Power"* ]]; then
  log "SKIP not connected to AC power: ${(q)power_source}"
  exit 0
fi

update_output="$(/usr/sbin/softwareupdate --list 2>&1)" || {
  log "ERROR failed to check for macOS updates"
  print -r -- "$update_output"
  exit 1
}

if [[ "$update_output" == *"No new software available."* ]]; then
  log "No recommended macOS update is pending; rebooting for weekly maintenance"
  /sbin/shutdown -r now
  exit 0
fi

log "Recommended macOS update detected; installing and allowing macOS to restart"
print -r -- "$update_output"
/usr/sbin/softwareupdate --install --recommended --restart --force

post_install_output="$(/usr/sbin/softwareupdate --list 2>&1)" || {
  log "ERROR could not verify update state after installation command"
  print -r -- "$post_install_output"
  exit 1
}

if [[ "$post_install_output" != *"No new software available."* ]]; then
  log "ERROR macOS update remains pending; refusing a generic reboot"
  print -r -- "$post_install_output"
  exit 1
fi

log "Update completed; rebooting for weekly maintenance if still running"
/sbin/shutdown -r now
