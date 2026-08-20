#!/bin/bash

set -uo pipefail
umask 077
export LC_ALL=C

server_root="$(cd "$(dirname "$0")/../.." && pwd)"
runtime_dir="${STARTUP_HEALTH_RUNTIME_DIR:-${server_root}/data/startup-health}"
webhook_file="${STARTUP_HEALTH_WEBHOOK_FILE:-${server_root}/power-monitor/discord-webhook.url}"
state_file="${STARTUP_HEALTH_STATE_FILE:-${runtime_dir}/macos-version.state}"
wait_seconds="${STARTUP_HEALTH_WAIT_SECONDS:-300}"
poll_seconds="${STARTUP_HEALTH_POLL_SECONDS:-10}"
docker_bin="${STARTUP_HEALTH_DOCKER_BIN:-/usr/local/bin/docker}"
curl_bin="${STARTUP_HEALTH_CURL_BIN:-/usr/bin/curl}"

timestamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { printf '[%s] %s\n' "$(timestamp)" "$*"; }

for value in "${wait_seconds}" "${poll_seconds}"; do
  if [[ ! "${value}" =~ ^[1-9][0-9]*$ ]]; then
    log "ERROR wait settings must be positive integers" >&2
    exit 1
  fi
done

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
  printf 'url = "%s"\n' "${webhook_url}" | "${curl_bin}" \
    --config - --fail --silent --show-error --max-time 15 \
    --header 'Content-Type: application/json' \
    --data-binary "${payload}" >/dev/null
}

expected=0
running=0
healthy=0
healthchecked=0
pending=0
unhealthy=0
compose_errors=0
recovery_errors=0
state_details=""

reconcile_always_on_services() {
  local compose_file
  local service

  while IFS='|' read -r compose_file service; do
    [[ -n "${compose_file}" ]] || continue
    if ! "${docker_bin}" compose -f "${compose_file}" up -d --pull never ${service:+"${service}"} >/dev/null 2>&1; then
      recovery_errors=$((recovery_errors + 1))
      log "ERROR failed to reconcile always-on service: ${compose_file}${service:+ (${service})}"
    fi
  done <<EOF
${server_root}/compose/homepage/compose.yaml|
${server_root}/compose/portainer/compose.yaml|portainer
EOF
}

collect_container_health() {
  local compose_file
  local project
  local service
  local container_id
  local health
  local is_running
  local state

  expected=0
  running=0
  healthy=0
  healthchecked=0
  pending=0
  unhealthy=0
  compose_errors=${recovery_errors}
  state_details=""

  for compose_file in "${server_root}"/compose/*/compose.yaml; do
    [[ -f "${compose_file}" ]] || continue
    project="$(basename "$(dirname "${compose_file}")")"

    case "${project}" in
      bluemap|dawarich|minecraft) continue ;;
    esac

    if ! services="$("${docker_bin}" compose -f "${compose_file}" config --services 2>/dev/null)"; then
      compose_errors=$((compose_errors + 1))
      continue
    fi

    while IFS= read -r service; do
      [[ -n "${service}" ]] || continue
      expected=$((expected + 1))
      container_id="$("${docker_bin}" compose -f "${compose_file}" ps -aq "${service}" 2>/dev/null | /usr/bin/head -n 1)"
      if [[ -z "${container_id}" ]]; then
        state_details="${state_details}${project}/${service}=missing, "
        continue
      fi

      is_running="$("${docker_bin}" inspect --format '{{.State.Running}}' "${container_id}" 2>/dev/null)" || {
        compose_errors=$((compose_errors + 1))
        continue
      }
      health="$("${docker_bin}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${container_id}" 2>/dev/null)" || {
        compose_errors=$((compose_errors + 1))
        continue
      }

      state="stopped"
      if [[ "${is_running}" == true ]]; then
        running=$((running + 1))
        state="running"
      fi

      case "${health}" in
        healthy)
          healthchecked=$((healthchecked + 1))
          if [[ "${is_running}" == true ]]; then
            healthy=$((healthy + 1))
            state="healthy"
          else
            unhealthy=$((unhealthy + 1))
            state="stopped"
          fi
          ;;
        starting)
          healthchecked=$((healthchecked + 1))
          if [[ "${is_running}" == true ]]; then
            pending=$((pending + 1))
            state="starting"
          else
            unhealthy=$((unhealthy + 1))
            state="stopped"
          fi
          ;;
        unhealthy)
          healthchecked=$((healthchecked + 1))
          unhealthy=$((unhealthy + 1))
          state="unhealthy"
          ;;
      esac
      state_details="${state_details}${project}/${service}=${state}, "
    done <<<"${services}"
  done

  state_details="${state_details%, }"
}

deadline=$((SECONDS + wait_seconds))
recovery_attempted=false
healthy_samples=0
healthy_signature=""
while true; do
  if "${docker_bin}" info >/dev/null 2>&1; then
    if [[ "${recovery_attempted}" == false ]]; then
      reconcile_always_on_services
      recovery_attempted=true
    fi
    collect_container_health
    if [[ "${expected}" -gt 0 && "${running}" -eq "${expected}" && "${pending}" -eq 0 && "${unhealthy}" -eq 0 && "${compose_errors}" -eq 0 ]]; then
      signature="${running}/${expected}:${healthy}/${healthchecked}:${state_details}"
      if [[ "${signature}" == "${healthy_signature}" ]]; then
        healthy_samples=$((healthy_samples + 1))
      else
        healthy_signature="${signature}"
        healthy_samples=1
      fi
      [[ "${healthy_samples}" -ge 2 ]] && break
    else
      healthy_samples=0
      healthy_signature=""
    fi
  fi

  [[ "${SECONDS}" -ge "${deadline}" ]] && break
  sleep "${poll_seconds}"
done

version="$(/usr/bin/sw_vers -productVersion)"
build="$(/usr/bin/sw_vers -buildVersion)"
current_version="${version} (${build})"
previous_version=""
[[ -f "${state_file}" ]] && IFS= read -r previous_version <"${state_file}"

tailscale_status="down"
/usr/bin/pgrep -x Tailscale >/dev/null 2>&1 && tailscale_status="up"

agents_loaded=0
for label in com.jack.power-monitor com.jack.macos-update-status; do
  /bin/launchctl print "gui/$(/usr/bin/id -u)/${label}" >/dev/null 2>&1 && agents_loaded=$((agents_loaded + 1))
done

recovery_ok=true
if [[ "${expected}" -eq 0 || "${running}" -ne "${expected}" || "${pending}" -ne 0 || "${unhealthy}" -ne 0 || "${compose_errors}" -ne 0 || "${tailscale_status}" != "up" || "${agents_loaded}" -ne 2 ]]; then
  recovery_ok=false
fi

if [[ "${recovery_ok}" == true ]]; then
  if [[ -n "${previous_version}" && "${previous_version}" != "${current_version}" ]]; then
    message="⬆️ **Update complete** · ${previous_version} → ${current_version}\\n${running}/${expected} containers · ${healthy}/${healthchecked} checks · Tailscale connected"
  else
    message="✅ **Server online** · macOS ${current_version}\\n${running}/${expected} containers · ${healthy}/${healthchecked} checks · Tailscale connected"
  fi
else
  issues=""
  [[ "${running}" -ne "${expected}" ]] && issues="${issues}${running}/${expected} containers · "
  [[ "${healthy}" -ne "${healthchecked}" ]] && issues="${issues}${healthy}/${healthchecked} checks (${pending} pending, ${unhealthy} unhealthy) · "
  [[ "${compose_errors}" -ne 0 ]] && issues="${issues}${compose_errors} Compose errors · "
  [[ "${tailscale_status}" != "up" ]] && issues="${issues}Tailscale disconnected · "
  [[ "${agents_loaded}" -ne 2 ]] && issues="${issues}${agents_loaded}/2 core agents · "
  issues="${issues% · }"

  if [[ -n "${previous_version}" && "${previous_version}" != "${current_version}" ]]; then
    message="⚠️ **Update complete with issues** · ${previous_version} → ${current_version}\\n${issues}\\n${state_details}"
  else
    message="⚠️ **Server online with issues** · macOS ${current_version}\\n${issues}\\n${state_details}"
  fi
fi

if ! post_message "${message}"; then
  log "ERROR failed to send startup health notification; launchd will retry" >&2
  exit 1
fi

state_tmp="${state_file}.tmp.$$"
printf '%s\n' "${current_version}" >"${state_tmp}"
mv -f "${state_tmp}" "${state_file}"
log "SENT startup health notification: recovery_ok=${recovery_ok} containers=${running}/${expected} health=${healthy}/${healthchecked}"
