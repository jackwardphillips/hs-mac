# Twitcher poller

## Scheduled runner

The server-owned entrypoint is:

```text
/Users/jack/Server/scripts/twitcher/run-twitcher-poller.sh
```

The intended crontab entry uses the Mac's `America/New_York` timezone:

```cron
0 0,2,6,8,10,12,14,16,18,20,22 * * * /Users/jack/Server/scripts/twitcher/run-twitcher-poller.sh
```

The runner pulls
`ghcr.io/jackwardphillips/twitcher-poller:production`, falls back to the
locally cached copy when GHCR is unavailable, prevents overlapping runs, and
runs the one-shot Compose service with `--rm`.

Human-readable output is written to
`apps/twitcher/backend/poller.log`. It rotates daily, is compressed, and is
retained for 14 days. Sanitized run summaries are written to
`apps/twitcher/backend/poller-history.jsonl` and retained for 90 days.

## Homepage health

The Homepage stack includes a local `poller-health` service that reads the
structured history file through a read-only mount. It has no published host
port; Homepage reaches it only over the stack's Docker network.

The Twitcher Ingestion card shows the latest run status and age, the percentage
of scheduled runs that fully succeeded in the rolling previous 72 hours, and
the latest eBird request success count. Missing scheduled runs count as
unsuccessful after the normal 30-minute completion grace period. Its status is:

- `Healthy` when the latest expected run completed with no recorded failures.
- `Degraded` when a completed run contains ingestion, target, eBird, or
  summarization failures.
- `Failed` when the latest run did not complete successfully.
- `Stale` when the latest expected scheduled run has not completed within its
  30-minute grace period.
- `Unknown` when no valid structured history exists.

The stale check follows the actual New York schedule, including the intentional
gap between the 2:00 AM and 6:00 AM runs. The card's `Status` field displays
the resulting state directly.

## Rollback

Show the current selection:

```text
/Users/jack/Server/scripts/twitcher/twitcher-poller-image.sh status
```

Activate a previously published immutable digest:

```text
/Users/jack/Server/scripts/twitcher/twitcher-poller-image.sh activate sha256:<64 hex characters>
```

Return to the latest successful production image:

```text
/Users/jack/Server/scripts/twitcher/twitcher-poller-image.sh clear
```

The override is stored in the Git-ignored
`config/twitcher-poller-image.override`. The scheduled runner logs whether it
is active. Never automatically retry a partially completed run with an older
image; inspect the run first, then select a rollback deliberately.

## Correlation

Each completed history record includes the image digest, source commit, and
Neon `AlertPollRun` identifier. Use that identifier to inspect the associated
target attempts and retry-level `EbirdApiCallLog` records.
