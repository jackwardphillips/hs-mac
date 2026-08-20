#!/bin/bash

set -uo pipefail
umask 077
export LC_ALL=C

server_root="/home/jack"
log_file="${MINECRAFT_LOG_FILE:-${server_root}/minecraft/briancraft-ii/logs/latest.log}"
webhook_file="${DISCORD_WEBHOOK_FILE:-${server_root}/minecraft/discord-join-webhook.url}"
state_file="${DISCORD_JOIN_STATE_FILE:-${server_root}/minecraft/discord-join-watcher.state}"
lock_dir="${DISCORD_JOIN_LOCK_DIR:-${server_root}/minecraft/.discord-join-watcher.lock}"
activity_file="${MINECRAFT_PLAYER_ACTIVITY_FILE:-${server_root}/minecraft/player-activity-date}"
poll_seconds="${DISCORD_JOIN_POLL_SECONDS:-2}"
curl_bin="${DISCORD_JOIN_CURL_BIN:-/usr/bin/curl}"
run_once=false
send_test=false

usage() {
  printf 'Usage: %s [--once | --test]\n' "$0"
}

case "${1:-}" in
  "")
    ;;
  --once)
    run_once=true
    ;;
  --test)
    run_once=true
    send_test=true
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

timestamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { printf '[%s] %s\n' "$(timestamp)" "$*"; }

if [[ ! -f "${webhook_file}" ]]; then
  log "ERROR webhook file is missing: ${webhook_file}" >&2
  exit 1
fi

chmod 600 "${webhook_file}" 2>/dev/null || {
  log "ERROR could not restrict webhook file permissions" >&2
  exit 1
}

IFS= read -r webhook_url <"${webhook_file}" || true
if [[ ! "${webhook_url}" =~ ^https://((canary|ptb)\.)?(discord|discordapp)\.com/api/webhooks/[0-9]+/[^[:space:]]+$ ]]; then
  log "ERROR webhook file does not contain a valid Discord webhook URL" >&2
  exit 1
fi

mkdir -p "$(dirname "${state_file}")"

if ! mkdir "${lock_dir}" 2>/dev/null; then
  lock_pid=""
  [[ -f "${lock_dir}/pid" ]] && read -r lock_pid <"${lock_dir}/pid"
  if [[ "${lock_pid}" =~ ^[0-9]+$ ]] && kill -0 "${lock_pid}" 2>/dev/null; then
    log "ERROR another Discord join watcher is already running" >&2
    exit 1
  fi
  rm -f "${lock_dir}/pid"
  rmdir "${lock_dir}" 2>/dev/null || {
    log "ERROR could not recover stale watcher lock" >&2
    exit 1
  }
  mkdir "${lock_dir}" || exit 1
fi
printf '%s\n' "$$" >"${lock_dir}/pid"

state_tmp="${state_file}.tmp.$$"
trap 'rm -f "${state_tmp}" "${lock_dir}/pid"; rmdir "${lock_dir}" 2>/dev/null || true' EXIT INT TERM

post_message() {
  local message="$1"
  local payload

  payload="$(printf '{"content":"%s","allowed_mentions":{"parse":[]}}' "${message}")"
  # Supplying the URL through curl's standard input keeps the credential out
  # of both watcher logs and process-list command arguments.
  printf 'url = "%s"\n' "${webhook_url}" | "${curl_bin}" \
    --config - \
    --fail \
    --silent \
    --show-error \
    --max-time 15 \
    --header 'Content-Type: application/json' \
    --data-binary "${payload}" \
    >/dev/null
}

write_state() {
  local inode="$1"
  local offset="$2"

  printf '%s %s\n' "${inode}" "${offset}" >"${state_tmp}"
  mv -f "${state_tmp}" "${state_file}"
}

record_player_activity() {
  local activity_tmp="${activity_file}.tmp.$$"

  mkdir -p "$(dirname "${activity_file}")"
  date '+%Y-%m-%d' >"${activity_tmp}"
  mv -f "${activity_tmp}" "${activity_file}"
}

if [[ "${send_test}" == true ]]; then
  if post_message "Minecraft join notifications are working."; then
    log "TEST Discord accepted the test notification"
    exit 0
  fi
  log "ERROR Discord rejected the test notification" >&2
  exit 1
fi

watch_once() {
  local inode
  local size
  local saved_inode=""
  local offset=0
  local line
  local player
  local consumed

  [[ -f "${log_file}" ]] || return 0

  inode="$(/usr/bin/stat -c '%i' "${log_file}")" || return 1
  size="$(/usr/bin/stat -c '%s' "${log_file}")" || return 1

  if [[ -f "${state_file}" ]]; then
    read -r saved_inode offset <"${state_file}" || {
      log "ERROR could not read watcher state" >&2
      return 1
    }
    [[ "${offset}" =~ ^[0-9]+$ ]] || {
      log "ERROR watcher state contains an invalid offset" >&2
      return 1
    }
  else
    # Do not replay historical joins when the watcher is installed initially.
    write_state "${inode}" "${size}"
    return 0
  fi

  if [[ "${saved_inode}" != "${inode}" || "${size}" -lt "${offset}" ]]; then
    offset=0
    write_state "${inode}" "${offset}"
  fi

  [[ "${size}" -gt "${offset}" ]] || return 0

  while IFS= read -r line; do
    consumed=$((${#line} + 1))

    if [[ "${line}" =~ \]:\ ([A-Za-z0-9_]{1,16})\ joined\ the\ game$ ]]; then
      player="${BASH_REMATCH[1]}"
      record_player_activity
      if post_message "🟢 ${player} joined Briancraft II."; then
        log "SENT join notification for ${player}"
      else
        log "ERROR failed to notify Discord that ${player} joined; will retry" >&2
        return 1
      fi
    fi

    offset=$((offset + consumed))
    write_state "${inode}" "${offset}"
  done < <(/usr/bin/tail -c "+$((offset + 1))" "${log_file}")
}

while true; do
  watch_once || exit 1
  [[ "${run_once}" == true ]] && exit 0
  sleep "${poll_seconds}"
done
