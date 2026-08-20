#!/bin/bash
set -uo pipefail

# Keep the player-facing schedule in Eastern time regardless of the host's
# system timezone.
export TZ="America/New_York"

service_dir="/home/jack/services/minecraft"
runtime_dir="/home/jack/minecraft"
log_file="${runtime_dir}/schedule.log"
status_file="${runtime_dir}/schedule-status.json"
lock_dir="${runtime_dir}/.schedule.lock"
disable_file="${runtime_dir}/.schedule-disabled"
force_file="${runtime_dir}/.schedule-force-enabled"
bluemap_lock_dir="/home/jack/bluemap/.render.lock"
bluemap_lock_pid_file="${bluemap_lock_dir}/pid"
docker_bin="/usr/bin/docker"

mkdir -p "${runtime_dir}"

timestamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { printf '[%s] %s\n' "$(timestamp)" "$*" >>"${log_file}"; }
write_status() {
  local status="$1" expected="$2" running="$3" detail="$4"
  local temporary="${status_file}.tmp.$$"
  printf '{"status":"%s","expected":"%s","running":%s,"checkedAt":"%s","detail":"%s"}\n' \
    "${status}" "${expected}" "${running}" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${detail}" >"${temporary}"
  mv "${temporary}" "${status_file}"
}

bluemap_render_is_active() {
  [[ -d "${bluemap_lock_dir}" ]] || return 1
  local bluemap_pid
  bluemap_pid="$(cat "${bluemap_lock_pid_file}" 2>/dev/null || true)"
  if [[ "${bluemap_pid}" =~ ^[0-9]+$ ]] && kill -0 "${bluemap_pid}" 2>/dev/null; then
    return 0
  fi
  rm -f "${bluemap_lock_pid_file}"
  if rmdir "${bluemap_lock_dir}" 2>/dev/null; then
    log "WARN cleared a stale BlueMap render lock"
  else
    log "WARN could not clear a stale BlueMap render lock"
  fi
  return 1
}

minecraft_should_run() {
  local day_of_week time_of_day
  [[ -f "${disable_file}" ]] && return 1
  bluemap_render_is_active && return 1
  [[ -f "${force_file}" ]] && return 0
  day_of_week="$(date +%u)"
  time_of_day="$((10#$(date +%H%M)))"
  if [[ "${day_of_week}" -le 5 ]]; then
    [[ "${time_of_day}" -ge 1700 ]]
  else
    [[ "${time_of_day}" -ge 730 ]]
  fi
}

if [[ "${1:-}" == --expected-state ]]; then
  if minecraft_should_run; then printf '%s\n' running; else printf '%s\n' stopped; fi
  exit 0
fi

if ! mkdir "${lock_dir}" 2>/dev/null; then exit 0; fi
trap 'rmdir "${lock_dir}" 2>/dev/null || true' EXIT INT TERM

if ! "${docker_bin}" info >/dev/null 2>&1; then
  log "WARN Docker is unavailable; schedule reconciliation skipped"
  write_status failed unknown false "Docker is unavailable"
  exit 1
fi

should_run=false
if minecraft_should_run; then should_run=true; fi
is_running="$("${docker_bin}" inspect --format '{{.State.Running}}' minecraft 2>/dev/null || printf false)"

if [[ "${should_run}" == true ]]; then
  if [[ "${is_running}" != true ]]; then
    if "${docker_bin}" compose -f "${service_dir}/compose.yaml" -f "${service_dir}/compose.surface.yaml" up -d --pull never minecraft >>"${log_file}" 2>&1; then
      log "START Minecraft entered its scheduled availability window"
    else
      log "ERROR failed to start Minecraft"
      write_status failed running false "Failed to start Minecraft"
      exit 1
    fi
  fi
elif [[ "${is_running}" == true ]]; then
  if "${docker_bin}" compose -f "${service_dir}/compose.yaml" -f "${service_dir}/compose.surface.yaml" stop -t 120 minecraft >>"${log_file}" 2>&1; then
    if [[ -f "${disable_file}" ]]; then
      log "STOP Minecraft administrative hold is enabled"
    elif bluemap_render_is_active; then
      log "STOP BlueMap rendering is active"
    else
      log "STOP Minecraft left its scheduled availability window"
    fi
  else
    log "ERROR failed to stop Minecraft"
    write_status failed stopped true "Failed to stop Minecraft"
    exit 1
  fi
fi

is_running="$("${docker_bin}" inspect --format '{{.State.Running}}' minecraft 2>/dev/null || printf false)"
if [[ "${should_run}" == true ]]; then expected_state=running; else expected_state=stopped; fi
if { [[ "${expected_state}" == running ]] && [[ "${is_running}" == true ]]; } || \
   { [[ "${expected_state}" == stopped ]] && [[ "${is_running}" != true ]]; }; then
  write_status healthy "${expected_state}" "${is_running}" "Schedule state matches"
else
  write_status failed "${expected_state}" "${is_running}" "Schedule state mismatch"
  exit 1
fi
