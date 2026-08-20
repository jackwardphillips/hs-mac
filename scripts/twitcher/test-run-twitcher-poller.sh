#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/twitcher-poller-test.XXXXXX")"
fake_docker="${test_root}/docker"
cleanup() { rm -rf "${test_root}"; }
trap cleanup EXIT

mkdir -p "${test_root}/apps/twitcher/backend"
touch "${test_root}/apps/twitcher/backend/docker-compose.poller.yml"

cat > "${fake_docker}" <<'FAKE'
#!/bin/bash
case "$1 $2" in
  "pull "*)
    [[ "${FAKE_PULL_FAIL:-false}" != "true" ]]
    ;;
  "image inspect")
    [[ "${FAKE_IMAGE_MISSING:-false}" != "true" ]] || exit 1
    if [[ "$3" == "--format" && "$4" == *RepoDigests* ]]; then
      echo "ghcr.io/jackwardphillips/twitcher-poller@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    elif [[ "$3" == "--format" ]]; then
      echo "0123456789abcdef"
    fi
    ;;
  "compose -f")
    echo 'POLLER_RESULT_JSON={"schemaVersion":1,"status":"success","ingestion":{"status":"success","emailsFound":2,"ingested":1,"skipped":1,"failed":0},"targets":{"attempted":3,"failed":0},"ebirdHttp":{"attempts":4,"failures":0},"summarization":{"status":"success","eligible":1,"updated":1,"skipped":0,"failed":0},"alertPollRunId":"run-1"}'
    exit "${FAKE_POLLER_STATUS:-0}"
    ;;
  *)
    exit 2
    ;;
esac
FAKE
chmod +x "${fake_docker}"

run_poller() {
  TWITCHER_SERVER_ROOT="${test_root}" DOCKER_BIN="${fake_docker}" NODE_BIN="$(command -v node)" \
    "${script_dir}/run-twitcher-poller.sh"
}

run_poller
grep -q '"alertPollRunId":"run-1"' "${test_root}/apps/twitcher/backend/poller-history.jsonl"
grep -q 'IMAGE digest=.*sha256:aaaaaaaa' "${test_root}/apps/twitcher/backend/poller.log"

FAKE_PULL_FAIL=true run_poller

if FAKE_PULL_FAIL=true FAKE_IMAGE_MISSING=true run_poller; then
  echo "expected missing cached image to fail" >&2
  exit 1
fi

mkdir "${test_root}/apps/twitcher/backend/.poller.lock"
if run_poller; then
  echo "expected held lock to fail" >&2
  exit 1
fi
rmdir "${test_root}/apps/twitcher/backend/.poller.lock"

if FAKE_POLLER_STATUS=7 run_poller; then
  echo "expected poller failure to propagate" >&2
  exit 1
fi

TWITCHER_SERVER_ROOT="${test_root}" "${script_dir}/twitcher-poller-image.sh" status |
  grep -q 'No override active'
TWITCHER_SERVER_ROOT="${test_root}" "${script_dir}/twitcher-poller-image.sh" \
  activate sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
TWITCHER_SERVER_ROOT="${test_root}" "${script_dir}/twitcher-poller-image.sh" status |
  grep -q 'Override active'
TWITCHER_SERVER_ROOT="${test_root}" "${script_dir}/twitcher-poller-image.sh" clear |
  grep -q 'No override active'

echo "run-twitcher-poller tests passed"
