#!/bin/bash
set -uo pipefail

force_render=false
require_previous_day_activity=false
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --force) force_render=true ;;
    --if-player-active) require_previous_day_activity=true ;;
    *) printf 'Usage: %s [--force] [--if-player-active]\n' "$0" >&2; exit 2 ;;
  esac
  shift
done

server_root="$(cd "$(dirname "$0")/../.." && pwd)"
docker_bin="/usr/local/bin/docker"
compose_file="${server_root}/compose/bluemap/compose.yaml"
mask_generator="${server_root}/scripts/minecraft/generate-bluemap-mask.mjs"
node_bin="/opt/homebrew/bin/node"
world_dir="${server_root}/minecraft/briancraft-ii/world"
mask_dir="${server_root}/bluemap/config/generated"
mask_file="${mask_dir}/overworld-mask.conf"
mask_cache="${mask_dir}/overworld-mask-cache.json"
runtime_dir="${server_root}/bluemap"
log_file="${runtime_dir}/render.log"
lock_dir="${runtime_dir}/.render.lock"
lock_pid_file="${lock_dir}/pid"
status_dir="${runtime_dir}/status"
status_file="${status_dir}/status.json"
activity_file="${MINECRAFT_PLAYER_ACTIVITY_FILE:-${server_root}/minecraft/player-activity-date}"
reconciler="${server_root}/scripts/minecraft/reconcile-minecraft-schedule.sh"
render_started_epoch=""
render_started_at=""
render_label="incremental"
render_in_progress=false
last_actual_completed_at=""
last_actual_duration_seconds=0
last_actual_duration="Unknown"

mkdir -p "${runtime_dir}"
mkdir -p "${status_dir}"

if [[ -f "${status_file}" ]]; then
  previous_actual_run="$("${node_bin}" -e '
    const fs = require("fs");
    try {
      const status = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const isActualSuccess = status.status === "Healthy" && status.mode !== "skipped";
      const completedAt = status.lastActualCompletedAt || (isActualSuccess ? status.completedAt : "");
      const durationSeconds = status.lastActualDurationSeconds ?? (isActualSuccess ? status.durationSeconds : 0);
      const duration = status.lastActualDuration || (isActualSuccess ? status.duration : "Unknown");
      process.stdout.write(`${completedAt}|${durationSeconds}|${duration}`);
    } catch {}
  ' "${status_file}")"
  IFS='|' read -r last_actual_completed_at last_actual_duration_seconds last_actual_duration <<<"${previous_actual_run}"
  last_actual_duration_seconds="${last_actual_duration_seconds:-0}"
  last_actual_duration="${last_actual_duration:-Unknown}"
fi

timestamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { printf '[%s] %s\n' "$(timestamp)" "$*" >>"${log_file}"; }

format_duration() {
  duration_seconds="$1"
  duration_hours="$((duration_seconds / 3600))"
  duration_minutes="$(((duration_seconds % 3600) / 60))"
  if [[ "${duration_hours}" -gt 0 ]]; then
    printf '%dh %dm' "${duration_hours}" "${duration_minutes}"
  else
    printf '%dm' "${duration_minutes}"
  fi
}

write_status() {
  status_value="$1"
  completed_at="$2"
  duration_seconds="$3"
  detail="$4"
  status_tmp="${status_file}.tmp.$$"
  duration_label="$(format_duration "${duration_seconds}")"
  if [[ "${status_value}" == "Healthy" && "${render_label}" != "skipped" ]]; then
    last_actual_completed_at="${completed_at}"
    last_actual_duration_seconds="${duration_seconds}"
    last_actual_duration="${duration_label}"
  fi
  printf '{\n  "status": "%s",\n  "mode": "%s",\n  "startedAt": "%s",\n  "completedAt": "%s",\n  "durationSeconds": %s,\n  "duration": "%s",\n  "lastActualCompletedAt": "%s",\n  "lastActualDurationSeconds": %s,\n  "lastActualDuration": "%s",\n  "detail": "%s"\n}\n' \
    "${status_value}" "${render_label}" "${render_started_at}" "${completed_at}" \
    "${duration_seconds}" "${duration_label}" "${last_actual_completed_at}" \
    "${last_actual_duration_seconds}" "${last_actual_duration}" "${detail}" >"${status_tmp}"
  /bin/mv "${status_tmp}" "${status_file}"
}

write_preflight_failure() {
  detail="$1"
  render_started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  write_status "Failed" "${render_started_at}" 0 "${detail}"
}

previous_local_date() {
  if [[ -n "${BLUEMAP_EXPECTED_ACTIVITY_DATE:-}" ]]; then
    printf '%s\n' "${BLUEMAP_EXPECTED_ACTIVITY_DATE}"
  else
    date -v-1d '+%Y-%m-%d'
  fi
}

cleanup() {
  exit_status=$?
  if [[ "${render_in_progress}" == true ]]; then
    completed_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    duration_seconds="$(($(date +%s) - render_started_epoch))"
    write_status "Failed" "${completed_at}" "${duration_seconds}" "Render interrupted"
  fi
  /bin/rm -f "${lock_pid_file}"
  rmdir "${lock_dir}" 2>/dev/null || true
  if "${docker_bin}" info >/dev/null 2>&1; then
    "${reconciler}" || log "WARN Minecraft schedule reconciliation failed after BlueMap render"
  fi
  return "${exit_status}"
}

if ! mkdir "${lock_dir}" 2>/dev/null; then
  log "SKIP another BlueMap render is already running"
  exit 0
fi
printf '%s\n' "$$" >"${lock_pid_file}"
trap cleanup EXIT INT TERM

if [[ "${require_previous_day_activity}" == true && "${force_render}" == false ]]; then
  expected_activity_date="$(previous_local_date)"
  recorded_activity_date=""
  [[ -f "${activity_file}" ]] && IFS= read -r recorded_activity_date <"${activity_file}"
  if [[ "${recorded_activity_date}" != "${expected_activity_date}" ]]; then
    render_label="skipped"
    render_started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    write_status "Skipped" "${render_started_at}" 0 "No player joined on ${expected_activity_date}"
    log "SKIP no player joined on ${expected_activity_date}"
    exit 0
  fi
fi

if ! "${docker_bin}" info >/dev/null 2>&1; then
  write_preflight_failure "Docker is unavailable"
  log "ERROR Docker is unavailable; BlueMap render skipped"
  exit 1
fi

minecraft_running="$("${docker_bin}" inspect --format '{{.State.Running}}' minecraft 2>/dev/null || printf 'false')"
if [[ "${minecraft_running}" == true ]]; then
  write_preflight_failure "Minecraft was still running"
  log "ERROR Minecraft is running; BlueMap requires a consistent stopped-world snapshot"
  exit 1
fi

mkdir -p "${mask_dir}"
log "MASK Generating one-chunk-buffered inhabited Overworld mask"
if ! "${node_bin}" "${mask_generator}" \
  --world "${world_dir}" \
  --output "${mask_file}" \
  --cache "${mask_cache}" >>"${log_file}" 2>&1; then
  write_preflight_failure "Mask generation failed"
  log "ERROR BlueMap mask generation failed; render skipped"
  exit 1
fi

if [[ "${force_render}" == true ]]; then
  render_label="forced"
fi

render_started_epoch="$(date +%s)"
render_started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
render_in_progress=true
write_status "Rendering" "" 0 "Render in progress"
log "START BlueMap ${render_label} Overworld render"
if [[ "${force_render}" == true ]]; then
  "${docker_bin}" compose -f "${compose_file}" --profile render run --rm bluemap-render \
    -f -r -m overworld -n /app/server/mods -v 1.21.1 >>"${log_file}" 2>&1
else
  "${docker_bin}" compose -f "${compose_file}" --profile render run --rm bluemap-render \
    >>"${log_file}" 2>&1
fi
status=$?
if [[ "${status}" -eq 0 ]]; then
  completed_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  duration_seconds="$(($(date +%s) - render_started_epoch))"
  write_status "Healthy" "${completed_at}" "${duration_seconds}" "Map is up to date"
  render_in_progress=false
  log "COMPLETE BlueMap ${render_label} Overworld render"
else
  completed_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  duration_seconds="$(($(date +%s) - render_started_epoch))"
  write_status "Failed" "${completed_at}" "${duration_seconds}" "Render exited with status ${status}"
  render_in_progress=false
  log "ERROR BlueMap render failed with status ${status}"
  exit "${status}"
fi
