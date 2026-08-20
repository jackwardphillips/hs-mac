#!/bin/zsh

set -euo pipefail
umask 077

server_root=${0:A:h:h:h}
compose_file="$server_root/compose/portainer/compose.yaml"
backup_dir="$server_root/backups/portainer"
keep_backups=14
timestamp=$(date '+%Y-%m-%d_%H-%M-%S')
archive_name="portainer_data_$timestamp.tar.gz"
temporary_archive="$backup_dir/$archive_name.incomplete"
final_archive="$backup_dir/$archive_name"
portainer_was_running=false

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

if [[ "$(docker inspect --format '{{.State.Running}}' portainer)" == "true" ]]; then
  portainer_was_running=true
  docker compose -f "$compose_file" stop portainer
fi

restart_portainer() {
  if [[ "$portainer_was_running" == "true" ]]; then
    docker compose -f "$compose_file" start portainer
  fi
}

trap restart_portainer EXIT

docker cp portainer:/data/. - | gzip > "$temporary_archive"

gzip -t "$temporary_archive"
mv "$temporary_archive" "$final_archive"

restart_portainer
portainer_was_running=false
trap - EXIT

backups=("$backup_dir"/portainer_data_*.tar.gz(N.om))
if (( ${#backups} > keep_backups )); then
  old_backups=("${backups[@]:$keep_backups}")
  rm -- "${old_backups[@]}"
fi

print "Created and verified: $final_archive"
