# Portainer backups

Portainer's configuration is stored in the Docker volume
`portainer_portainer_data`. Local backups are written to
`backups/portainer/`, which is excluded from Git. The backup directory and
archives are restricted to the server account because they contain Portainer's
database, certificates, and private keys.

## Create a backup

Run:

```sh
./scripts/portainer/backup-portainer.sh
```

The script:

1. Stops Portainer briefly for a consistent snapshot.
2. Streams `/data` from the stopped container into a compressed archive.
3. Restarts Portainer, including when backup creation fails.
4. Checks the gzip archive and retains the newest 14 backups.

These local backups protect against accidental container or volume changes,
but not against failure or loss of the server's internal storage. Copy them
to separate storage for that protection.

## Restore

Restoring replaces the current contents of the Portainer data volume. Do not
run a restore without checking the selected archive and explicitly approving
the data replacement.

Before restoring:

1. Confirm the archive is the intended backup with `gzip -t ARCHIVE`.
2. Stop Portainer.
3. Take a backup of the current volume when it is still readable.
4. Restore the archive into the existing `portainer_portainer_data` volume.
5. Start Portainer and verify its status and logs.

The restore is intentionally documented as a procedure rather than an
automated script because clearing the destination volume is destructive.
