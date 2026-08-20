#!/bin/bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
subject="${script_dir}/notify-discord-startup-health.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

mock_docker="${test_dir}/docker"
mock_curl="${test_dir}/curl"
mock_scheduler="${test_dir}/minecraft-scheduler"
webhook_file="${test_dir}/webhook.url"
payload_file="${test_dir}/payload.txt"

printf '%s%s\n' 'https://discord.com/api/' 'webhooks/123/test-token' >"${webhook_file}"

cat >"${mock_docker}" <<'MOCK'
#!/bin/bash
set -eu

if [[ "$1" == info ]]; then
  exit 0
fi

if [[ "$1" == compose ]]; then
  compose_file="$3"
  action="$4"
  if [[ "${action}" == up ]]; then
    exit 0
  fi
  if [[ "${action}" == config && "$5" == --services ]]; then
    case "${compose_file}" in
      */homepage/*) printf '%s\n' docker-proxy homepage poller-health ;;
      */portainer/*) printf '%s\n' portainer ;;
      */bluemap/*) printf '%s\n' bluemap ;;
      */minecraft/*) printf '%s\n' minecraft ;;
    esac
    exit 0
  fi
  if [[ "${action}" == ps && "$5" == -aq ]]; then
    printf '%s\n' "$6"
    exit 0
  fi
fi

if [[ "$1" == inspect ]]; then
  format="$3"
  container="$4"
  if [[ "${format}" == '{{.State.Running}}' ]]; then
    if [[ "${MOCK_STOPPED:-}" == "${container}" ]]; then
      printf '%s\n' false
    else
      printf '%s\n' true
    fi
    exit 0
  fi
  case "${container}" in
    docker-proxy|homepage|poller-health|bluemap|minecraft) printf '%s\n' healthy ;;
    *) printf '%s\n' none ;;
  esac
  exit 0
fi

exit 1
MOCK

cat >"${mock_curl}" <<'MOCK'
#!/bin/bash
printf '%s\n' "$*" >"${MOCK_PAYLOAD_FILE}"
MOCK

cat >"${mock_scheduler}" <<'MOCK'
#!/bin/bash
printf '%s\n' "${MOCK_MINECRAFT_EXPECTED:-running}"
MOCK

chmod +x "${mock_docker}" "${mock_curl}" "${mock_scheduler}"

run_subject() {
  local stopped="${1:-}"
  local minecraft_expected="${2:-running}"
  local runtime_dir="${test_dir}/runtime-${stopped:-healthy}-${minecraft_expected}"
  mkdir -p "${runtime_dir}"
  STARTUP_HEALTH_RUNTIME_DIR="${runtime_dir}" \
    STARTUP_HEALTH_WEBHOOK_FILE="${webhook_file}" \
    STARTUP_HEALTH_WAIT_SECONDS=1 \
    STARTUP_HEALTH_POLL_SECONDS=1 \
    STARTUP_HEALTH_DOCKER_BIN="${mock_docker}" \
    STARTUP_HEALTH_CURL_BIN="${mock_curl}" \
    STARTUP_HEALTH_MINECRAFT_SCHEDULER="${mock_scheduler}" \
    MOCK_PAYLOAD_FILE="${payload_file}" \
    MOCK_STOPPED="${stopped}" \
    MOCK_MINECRAFT_EXPECTED="${minecraft_expected}" \
    bash "${subject}" >/dev/null
}

run_subject homepage
grep -Fq '3/4 containers' "${payload_file}"
grep -Fq '2/3 checks (0 pending, 1 unhealthy)' "${payload_file}"
grep -Fq 'homepage/homepage=stopped' "${payload_file}"

run_subject
grep -Fq '4/4 containers' "${payload_file}"
grep -Fq '3/3 checks' "${payload_file}"

run_subject minecraft stopped
grep -Fq '4/4 containers' "${payload_file}"
grep -Fq '3/3 checks' "${payload_file}"

run_subject homepage stopped
grep -Fq '3/4 containers' "${payload_file}"
grep -Fq '2/3 checks (0 pending, 1 unhealthy)' "${payload_file}"

printf '%s\n' 'startup-health regression tests passed'
