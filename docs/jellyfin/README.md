# Jellyfin operations

Jellyfin runs natively on Apple Silicon through the official Homebrew cask and
is supervised headlessly by the `com.jack.jellyfin` user LaunchAgent. Native
execution preserves supported macOS library scanning and Apple VideoToolbox
hardware transcoding; Docker Desktop is not used for this service.

The tracked LaunchAgent starts the official wrapper, which in turn starts and
stops its bundled Jellyfin server and FFmpeg processes. Invoking the bundled
server executable directly bypasses the supported macOS application launch
chain and is not used.

The server listens on the LAN at `http://<server-LAN-IP>:8096`. Do not create a
router port forward or enable public remote access. UDP port 7359 may be used
by Jellyfin's LAN client discovery after the initial web setup.

## Storage

Application state remains on the internal disk under:

```text
/Users/jack/Library/Application Support/Jellyfin
```

Its `data/` directory contains the database and metadata, `config/` contains
server configuration, `cache/` contains disposable cache and transcode files,
and `log/` contains Jellyfin's application logs. The Git-ignored
`data/jellyfin-launchd.log` file captures wrapper stdout and stderr.

Initial media is stored in the repository's Git-ignored media directories:

```text
/Users/jack/Server/media/movies
/Users/jack/Server/media/tv
/Users/jack/Server/media/music
```

Add those paths as separate libraries during the initial setup wizard. Keep
metadata in Jellyfin's application paths rather than saving it beside media.

## Dashboard configuration

After the initial account wizard, apply these authenticated settings in the
Jellyfin administration dashboard:

1. Under `Server > Libraries`, create separate Movies, Shows, and Music
   libraries using the three local media paths above.
2. Under `Server > Playback > Transcoding`, select `VideoToolbox` hardware
   acceleration. Enable hardware encoding and VideoToolbox tone mapping; leave
   unsupported codecs deselected. Verify this with a deliberately forced
   transcode from a client rather than assuming direct play exercises it.
3. Under `Server > Networking`, disable remote connections but leave Auto
   Discovery enabled. LAN clients continue to use TCP port 8096 and discovery
   on UDP port 7359.

The macOS application firewall remains enabled. Test the final connection from
an actual TV because a request from the server to its own LAN address does not
prove client-side discovery or firewall behavior.

## LaunchAgent

Install or refresh the tracked definition:

```sh
touch data/jellyfin-launchd.log
chmod 600 data/jellyfin-launchd.log

cp config/launchd/com.jack.jellyfin.plist \
  ~/Library/LaunchAgents/com.jack.jellyfin.plist
launchctl bootout "gui/$(id -u)/com.jack.jellyfin" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" \
  ~/Library/LaunchAgents/com.jack.jellyfin.plist
```

Inspect service state, health, listeners, and logs:

```sh
launchctl print "gui/$(id -u)/com.jack.jellyfin"
curl -fsS http://localhost:8096/health
lsof -nP -iTCP:8096 -sTCP:LISTEN
tail -n 100 data/jellyfin-launchd.log
tail -n 100 "$HOME/Library/Application Support/Jellyfin/log/"*.log
```

Restart the process without changing its data:

```sh
launchctl kickstart -k "gui/$(id -u)/com.jack.jellyfin"
```

## Updates

Back up Jellyfin, stop it, upgrade the cask, and start it again. Do not upgrade
while the database is active.

```sh
launchctl bootout "gui/$(id -u)/com.jack.jellyfin"
brew upgrade --cask jellyfin
cp config/launchd/com.jack.jellyfin.plist \
  ~/Library/LaunchAgents/com.jack.jellyfin.plist
launchctl bootstrap "gui/$(id -u)" \
  ~/Library/LaunchAgents/com.jack.jellyfin.plist
curl -fsS http://localhost:8096/health
```

Homebrew restores macOS's quarantine marker to a replacement app. After an
upgrade, approve the notarized replacement once through macOS before relying
on headless startup. Do not invoke the bundled server executable directly.

## External SSD migration

Use a stable volume name, preferably on an APFS-formatted SSD. Grant Jellyfin
removable-storage access if macOS requests it. Copy media without changing the
internal application-state directories, then migrate one library at a time:

1. Copy a media directory to `/Volumes/<SSD-name>/`.
2. Add the SSD directory to the corresponding existing Jellyfin library.
3. Scan the library and verify playback from a TV.
4. Remove the old local media directory from the Jellyfin library.
5. Remove the old files only after a separate backup and explicit approval.

If the SSD is disconnected, Jellyfin remains available but content on that
volume will be unavailable. Reconnect it at the same volume path before
rescanning; do not allow a scan to remove missing content during an outage.

## Backup and recovery

Use Jellyfin's built-in backup feature or stop the LaunchAgent before copying
`~/Library/Application Support/Jellyfin/data` and
`~/Library/Application Support/Jellyfin/config`. Cache, transcodes, and logs
do not need to be restored. Preserve a backup from before every application
upgrade and test restoration before treating backups as reliable.
