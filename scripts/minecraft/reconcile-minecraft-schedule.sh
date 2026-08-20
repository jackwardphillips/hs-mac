#!/bin/bash
set -uo pipefail

server_root="$(cd "$(dirname "$0")/../.." && pwd)"
docker_bin="/usr/local/bin/docker"
compose_file="${server_root}/compose/minecraft/compose.yaml"
runtime_dir="${server_root}/minecraft"
log_file="${runtime_dir}/schedule.log"
lock_dir="${runtime_dir}/.schedule.lock"
disable_file="${runtime_dir}/.schedule-disabled"
force_file="${runtime_dir}/.schedule-force-enabled"
bluemap_lock_dir="${server_root}/bluemap/.render.lock"
bluemap_lock_pid_file="${bluemap_lock_dir}/pid"
launchctl_bin="/bin/launchctl"
launchd_domain="gui/$(id -u)"
watcher_label="com.jack.minecraft-discord-join"
watcher_service="${launchd_domain}/${watcher_label}"
watcher_plist="${server_root}/config/launchd/${watcher_label}.plist"

mkdir -p "${runtime_dir}"

timestamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { printf '[%s] %s\n' "$(timestamp)" "$*" >>"${log_file}"; }

bluemap_render_is_active() {
  [[ -d "${bluemap_lock_dir}" ]] || return 1

  bluemap_pid="$(cat "${bluemap_lock_pid_file}" 2>/dev/null || true)"
  if [[ "${bluemap_pid}" =~ ^[0-9]+$ ]] && kill -0 "${bluemap_pid}" 2>/dev/null; then
    return 0
  fi

  /bin/rm -f "${bluemap_lock_pid_file}"
  if rmdir "${bluemap_lock_dir}" 2>/dev/null; then
    log "WARN cleared a stale BlueMap render lock"
  else
    log "WARN could not clear a stale BlueMap render lock"
  fi
  return 1
}

watcher_is_loaded() {
  "${launchctl_bin}" print "${watcher_service}" >/dev/null 2>&1
}

start_watcher() {
  watcher_is_loaded && return 0

  if "${launchctl_bin}" bootstrap "${launchd_domain}" "${watcher_plist}" >/dev/null 2>&1; then
    log "WATCHER Discord join notifications enabled for the availability window"
  else
    log "ERROR failed to start the Discord join watcher"
    return 1
  fi
}

stop_watcher() {
  watcher_is_loaded || return 0

  if "${launchctl_bin}" bootout "${watcher_service}" >/dev/null 2>&1; then
    log "WATCHER Discord join notifications disabled outside the availability window"
  else
    log "ERROR failed to stop the Discord join watcher"
    return 1
  fi
}

minecraft_should_run() {
  local day_of_week
  local time_of_day

  if [[ -f "${disable_file}" ]]; then
    return 1
  fi
  if bluemap_render_is_active; then
    return 1
  fi
  if [[ -f "${force_file}" ]]; then
    return 0
  fi

  day_of_week="$(date +%u)"
  time_of_day="$((10#$(date +%H%M)))"
  if [[ "${day_of_week}" -le 5 ]]; then
    [[ "${time_of_day}" -ge 1700 ]]
  else
    [[ "${time_of_day}" -ge 730 ]]
  fi
}

if [[ "${1:-}" == --expected-state ]]; then
  if minecraft_should_run; then
    printf '%s\n' running
  else
    printf '%s\n' stopped
  fi
  exit 0
fi

if ! mkdir "${lock_dir}" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "${lock_dir}" 2>/dev/null || true' EXIT INT TERM

if ! "${docker_bin}" info >/dev/null 2>&1; then
  stop_watcher || true
  log "WARN Docker is unavailable; schedule reconciliation skipped"
  exit 1
fi

should_run=false
if minecraft_should_run; then
  should_run=true
fi

is_running="$("${docker_bin}" inspect --format '{{.State.Running}}' minecraft 2>/dev/null || printf 'false')"

if [[ "${should_run}" == true ]]; then
  start_watcher || true

  if [[ "${is_running}" != true ]]; then
    if "${docker_bin}" compose -f "${compose_file}" up -d --pull never minecraft >>"${log_file}" 2>&1; then
      log "START Minecraft entered its scheduled availability window"
    else
      log "ERROR failed to start Minecraft"
      exit 1
    fi
  fi
else
  if [[ "${is_running}" == true ]]; then
    if "${docker_bin}" compose -f "${compose_file}" stop -t 120 minecraft >>"${log_file}" 2>&1; then
      if [[ -f "${disable_file}" ]]; then
        log "STOP Minecraft administrative hold is enabled"
      elif bluemap_render_is_active; then
        log "STOP BlueMap rendering is active"
      else
        log "STOP Minecraft left its scheduled availability window"
      fi
    else
      log "ERROR failed to stop Minecraft"
      exit 1
    fi
  fi

  stop_watcher || true
fi
