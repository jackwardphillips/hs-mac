#!/bin/bash

set -uo pipefail
umask 077
export LC_ALL=C

server_root="$(cd "$(dirname "$0")/../.." && pwd)"
runtime_dir="${POWER_MONITOR_RUNTIME_DIR:-${server_root}/power-monitor}"
webhook_file="${POWER_MONITOR_WEBHOOK_FILE:-${runtime_dir}/discord-webhook.url}"
state_file="${POWER_MONITOR_STATE_FILE:-${runtime_dir}/power-source.state}"
alert_level_file="${POWER_MONITOR_ALERT_LEVEL_FILE:-${runtime_dir}/battery-alert-level.state}"
poll_seconds="${POWER_MONITOR_POLL_SECONDS:-20}"
pmset_bin="${POWER_MONITOR_PMSET_BIN:-/usr/bin/pmset}"
curl_bin="${POWER_MONITOR_CURL_BIN:-/usr/bin/curl}"
run_once=false
send_test=false

usage() {
  printf 'Usage: %s [--once | --test]\n' "$0"
}

case "${1:-}" in
  "") ;;
  --once) run_once=true ;;
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

if [[ ! "${poll_seconds}" =~ ^[1-9][0-9]*$ ]]; then
  log "ERROR poll interval must be a positive integer" >&2
  exit 1
fi

mkdir -p "${runtime_dir}"
chmod 700 "${runtime_dir}" 2>/dev/null || {
  log "ERROR could not restrict runtime directory permissions" >&2
  exit 1
}

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

post_message() {
  local message="$1"
  local payload

  payload="$(printf '{\"content\":\"%s\",\"allowed_mentions\":{\"parse\":[]}}' "${message}")"
  # Read curl configuration from stdin so the webhook never appears in the
  # process list or operational log.
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

read_power() {
  local output
  local source
  local percentage

  output="$("${pmset_bin}" -g batt)" || return 1

  case "${output}" in
    *"Now drawing from 'AC Power'"*) source="ac" ;;
    *"Now drawing from 'Battery Power'"*) source="battery" ;;
    *)
      log "ERROR pmset returned an unknown power source" >&2
      return 1
      ;;
  esac

  percentage="$(printf '%s\n' "${output}" | /usr/bin/sed -n 's/.*[[:space:]]\([0-9][0-9]*\)%;.*/\1/p' | /usr/bin/head -n 1)"
  [[ "${percentage}" =~ ^[0-9]+$ ]] || percentage="unknown"

  printf '%s %s\n' "${source}" "${percentage}"
}

write_state() {
  local source="$1"
  local state_tmp="${state_file}.tmp.$$"

  printf '%s\n' "${source}" >"${state_tmp}"
  mv -f "${state_tmp}" "${state_file}"
}

if [[ "${send_test}" == true ]]; then
  if post_message "✅ jack-server power notifications are working."; then
    log "TEST Discord accepted the power notification"
    exit 0
  fi
  log "ERROR Discord rejected the test notification" >&2
  exit 1
fi

check_once() {
  local reading
  local source
  local percentage
  local previous=""
  local message
  local alert_level="none"
  local desired_level="normal"

  reading="$(read_power)" || return 1
  read -r source percentage <<<"${reading}"
  [[ -f "${state_file}" ]] && IFS= read -r previous <"${state_file}"
  [[ -f "${alert_level_file}" ]] && IFS= read -r alert_level <"${alert_level_file}"

  if [[ -z "${previous}" && "${source}" == "ac" ]]; then
    write_state "${source}"
    printf 'none\n' >"${alert_level_file}"
    log "INIT power source is AC"
    return 0
  fi

  if [[ "${source}" == "ac" ]]; then
    [[ "${previous}" == "ac" ]] && return 0
    message="✅ **AC power restored** · Battery ${percentage}%"
  else
    if [[ "${percentage}" =~ ^[0-9]+$ && "${percentage}" -le 15 ]]; then
      desired_level="critical"
    elif [[ "${percentage}" =~ ^[0-9]+$ && "${percentage}" -le 30 ]]; then
      desired_level="low"
    fi

    if [[ "${previous}" != "battery" ]]; then
      case "${desired_level}" in
        critical) message="🚨 **Battery critical** · ${percentage}% remaining\\nConnect AC power soon" ;;
        low) message="⚠️ **Battery low** · ${percentage}% remaining\\nServer is still running on battery" ;;
        *) message="⚠️ **Running on battery** · ${percentage}% remaining" ;;
      esac
    elif [[ "${desired_level}" == "critical" && "${alert_level}" != "critical" ]]; then
      message="🚨 **Battery critical** · ${percentage}% remaining\\nConnect AC power soon"
    elif [[ "${desired_level}" == "low" && "${alert_level}" == "normal" ]]; then
      message="⚠️ **Battery low** · ${percentage}% remaining\\nServer is still running on battery"
    else
      return 0
    fi
  fi

  if post_message "${message}"; then
    write_state "${source}"
    if [[ "${source}" == "ac" ]]; then
      printf 'none\n' >"${alert_level_file}"
    else
      printf '%s\n' "${desired_level}" >"${alert_level_file}"
    fi
    log "SENT power transition notification: ${source} (${percentage}%)"
    return 0
  fi

  log "ERROR failed to send power transition notification; will retry" >&2
  return 1
}

if [[ "${run_once}" == true ]]; then
  check_once
  exit $?
fi

while true; do
  check_once || true
  sleep "${poll_seconds}"
done
