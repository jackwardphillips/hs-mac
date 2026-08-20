# Beszel

Beszel is running as a side-by-side trial with Netdata. The Hub provides a
compact, tailnet-only server-health dashboard; Netdata remains available for
deeper process and macOS memory-pressure diagnostics.

## Access

- Dashboard: `https://mac.example:8090/`
- Local listener: `localhost:8090`
- Compose definition: `compose/beszel/compose.yaml`

Tailscale Funnel must remain disabled.

## Operations

```sh
docker compose -f compose/beszel/compose.yaml ps
docker compose -f compose/beszel/compose.yaml logs
docker compose -f compose/beszel/compose.yaml pull
docker compose -f compose/beszel/compose.yaml up -d
```

The persistent Hub database is stored in the `beszel_data` named volume. Do
not remove the volume during routine updates or troubleshooting.

## Agent

The native ARM64 macOS agent is installed from the trusted
`henrygd/beszel` Homebrew tap and supervised by Homebrew services. It connects
outbound to the Hub through `localhost:8090`; its SSH server is disabled, so it
does not open agent port 45876. The pairing key and universal token must not be
committed to Git. They are stored owner-readable only in
`~/.config/beszel/beszel-agent.env`.

```sh
brew services info beszel-agent
brew services restart beszel-agent
tail -f ~/.cache/beszel/beszel-agent.log
```

The agent reports the macOS host and read-only Docker statistics to the Hub.
