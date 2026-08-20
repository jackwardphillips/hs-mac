#!/bin/bash
set -uo pipefail

server_root="${TWITCHER_SERVER_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
docker_bin="${DOCKER_BIN:-/usr/local/bin/docker}"
node_bin="${NODE_BIN:-$(command -v node)}"
backend_dir="${server_root}/apps/twitcher/backend"
log_file="${backend_dir}/poller.log"
history_file="${backend_dir}/poller-history.jsonl"
lock_dir="${backend_dir}/.poller.lock"
override_file="${server_root}/config/twitcher-poller-image.override"
production_image="ghcr.io/jackwardphillips/twitcher-poller:production"
run_started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
started_epoch="$(date +%s)"

timestamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { printf '[%s] %s\n' "$(timestamp)" "$*" | tee -a "${log_file}"; }

rotate_log() {
  [[ -f "${log_file}" ]] || return 0
  local modified today archived
  modified="$(date -r "${log_file}" +%Y-%m-%d)"
  today="$(date +%Y-%m-%d)"
  [[ "${modified}" == "${today}" ]] && return 0
  archived="${log_file}.${modified}"
  mv "${log_file}" "${archived}"
  gzip -f "${archived}"
  find "${backend_dir}" -name 'poller.log.*.gz' -type f -mtime +14 -delete
}

rotate_log
if ! mkdir "${lock_dir}" 2>/dev/null; then
  log "ERROR another poller run holds ${lock_dir}"
  exit 1
fi
work_file="$(mktemp "${TMPDIR:-/tmp}/twitcher-poller.XXXXXX")"
cleanup() {
  rm -f "${work_file}"
  rmdir "${lock_dir}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

image="${production_image}"
override_active=false
if [[ -f "${override_file}" ]]; then
  image="$(<"${override_file}")"
  override_active=true
  if [[ ! "${image}" =~ ^ghcr\.io/jackwardphillips/twitcher-poller@sha256:[0-9a-f]{64}$ ]]; then
    log "ERROR invalid image override; refusing to run"
    exit 1
  fi
fi

log "START poller image=${image} override=${override_active}"
if ! "${docker_bin}" pull "${image}" >>"${log_file}" 2>&1; then
  log "WARN image pull failed; checking the local image cache"
fi
if ! "${docker_bin}" image inspect "${image}" >/dev/null 2>&1; then
  log "ERROR no usable local image exists for ${image}"
  exit 1
fi

digest="$("${docker_bin}" image inspect --format '{{index .RepoDigests 0}}' "${image}" 2>/dev/null)"
revision="$("${docker_bin}" image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${image}" 2>/dev/null)"
if [[ -z "${digest}" || "${digest}" == "<no value>" || -z "${revision}" || "${revision}" == "<no value>" ]]; then
  log "ERROR selected image lacks digest or source revision metadata"
  exit 1
fi
log "IMAGE digest=${digest} revision=${revision}"

set +e
(cd "${backend_dir}" && TWITCHER_POLLER_IMAGE="${image}" \
  "${docker_bin}" compose -f docker-compose.poller.yml run --rm twitcher-poller) \
  2>&1 | tee -a "${log_file}" "${work_file}"
poller_status=${PIPESTATUS[0]}
set -e

poller_json="$(awk -F= '/^POLLER_RESULT_JSON=/{value=substr($0,index($0,"=")+1)} END{print value}' "${work_file}")"
finished="$(timestamp)"
duration="$(( $(date +%s) - started_epoch ))"
history_status="${poller_status}"

if ! RUN_STARTED="${run_started}" RUN_FINISHED="${finished}" RUN_DURATION="${duration}" \
  IMAGE_DIGEST="${digest}" SOURCE_REVISION="${revision}" OVERRIDE_ACTIVE="${override_active}" \
  POLLER_STATUS="${poller_status}" POLLER_JSON="${poller_json}" HISTORY_FILE="${history_file}" \
  "${node_bin}" --input-type=module -e '
    import fs from "node:fs";
    const result = process.env.POLLER_JSON ? JSON.parse(process.env.POLLER_JSON) : null;
    const record = {
      schemaVersion: 1,
      startedAt: process.env.RUN_STARTED,
      finishedAt: process.env.RUN_FINISHED,
      durationSeconds: Number(process.env.RUN_DURATION),
      status: result?.status ?? "failure",
      imageDigest: process.env.IMAGE_DIGEST,
      sourceCommit: process.env.SOURCE_REVISION,
      overrideActive: process.env.OVERRIDE_ACTIVE === "true",
      ingestion: result?.ingestion ?? null,
      targets: result?.targets ?? { attempted: 0, failed: 0 },
      ebirdHttp: result?.ebirdHttp ?? { attempts: 0, failures: 0 },
      summarization: result?.summarization ?? { status: "not_completed" },
      alertPollRunId: result?.alertPollRunId ?? null
    };
    fs.appendFileSync(process.env.HISTORY_FILE, JSON.stringify(record) + "\n", { mode: 0o600 });
    const cutoff = Date.now() - 90 * 86400000;
    const kept = fs.readFileSync(process.env.HISTORY_FILE, "utf8").split("\n")
      .filter(Boolean).filter(line => {
        try { return Date.parse(JSON.parse(line).finishedAt) >= cutoff; } catch { return false; }
      });
    fs.writeFileSync(process.env.HISTORY_FILE, kept.join("\n") + (kept.length ? "\n" : ""), { mode: 0o600 });
  ' >>"${log_file}" 2>&1; then
  log "ERROR failed to write structured poller history"
  history_status=1
fi

if [[ "${poller_status}" -eq 0 && "${history_status}" -eq 0 ]]; then
  log "SUCCESS poller completed durationSeconds=${duration}"
  exit 0
fi
log "ERROR poller completed status=${poller_status} durationSeconds=${duration}"
exit 1
