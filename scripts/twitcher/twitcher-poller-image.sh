#!/bin/bash
set -euo pipefail

server_root="${TWITCHER_SERVER_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
override_file="${server_root}/config/twitcher-poller-image.override"
repository="ghcr.io/jackwardphillips/twitcher-poller"

usage() {
  echo "Usage: $0 status | activate <sha256 digest> | clear"
}

case "${1:-}" in
  status)
    if [[ -f "${override_file}" ]]; then
      echo "Override active: $(<"${override_file}")"
    else
      echo "No override active; production tag will be used."
    fi
    ;;
  activate)
    digest="${2:-}"
    if [[ ! "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      echo "Expected a full sha256 digest." >&2
      exit 2
    fi
    mkdir -p "$(dirname "${override_file}")"
    umask 077
    printf '%s@%s\n' "${repository}" "${digest}" > "${override_file}"
    echo "Override active: ${repository}@${digest}"
    ;;
  clear)
    if [[ -f "${override_file}" ]]; then
      rm "${override_file}"
    fi
    echo "No override active; production tag will be used."
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
