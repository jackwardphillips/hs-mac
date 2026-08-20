# Minecraft changelog

Notable changes to the Minecraft service are recorded here in reverse
chronological order.

## 2026-08-18

- Reduced the maximum Java heap from 4 GiB to 3.5 GiB and reduced view and
  simulation distances to 16 and 8 chunks to lower Docker Desktop memory
  pressure.

## 2026-07-30

- Added Discord notifications for successful player joins, with persistent
  log cursor tracking and delivery retries.
- Integrated the Discord watcher with the Minecraft availability schedule so
  it runs only while the server is available.
- Increased the server view distance from 16 to 24 chunks. Kept the
  simulation distance at 12 chunks.

## 2026-07-26

- Deployed the Briancraft II Fabric 1.21.1 server using a pinned Java 21
  container image.
- Configured the Java heap to start at 2 GiB and grow to at most 4 GiB, with
  startup-aware health checks and graceful shutdowns.
- Enabled Mojang online authentication and whitelist enforcement.
- Added scheduled availability from 5:00 PM to midnight on weekdays and
  7:30 AM to midnight on weekends in `America/New_York`.
- Enabled automatic Java-process pausing after ten minutes without connected
  players.
- Added administrative hold and force-running overrides for maintenance.
