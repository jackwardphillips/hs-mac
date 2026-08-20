#!/bin/zsh

set -euo pipefail
umask 077

server_root=${0:A:h:h:h}
status_dir="$server_root/data/system-update"
status_file="$status_dir/status.json"
temporary_file="$status_dir/status.json.tmp"
checked_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

mkdir -p "$status_dir"
chmod 700 "$status_dir"

update_output="$(/usr/sbin/softwareupdate --list 2>&1)" || {
  printf '{"status":"Check failed","version":"Unknown","checkedAt":"%s"}\n' \
    "$checked_at" >"$temporary_file"
  mv "$temporary_file" "$status_file"
  exit 1
}

if [[ "$update_output" == *"No new software available."* ]]; then
  update_status="Up to date"
  version="Current"
else
  version="$(printf '%s\n' "$update_output" |
    /usr/bin/sed -nE 's/.*Version: ([^,]+).*/\1/p' |
    /usr/bin/head -n 1)"

  if [[ -n "$version" ]]; then
    update_status="Update available"
  else
    update_status="Check required"
    version="Unknown"
  fi
fi

printf '{"status":"%s","version":"%s","checkedAt":"%s"}\n' \
  "$update_status" "$version" "$checked_at" >"$temporary_file"
mv "$temporary_file" "$status_file"
