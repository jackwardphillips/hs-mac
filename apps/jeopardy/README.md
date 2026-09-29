# Living Room Jeopardy

A private-LAN game for one host screen and 2–4 phone players. The host chooses clues and judges spoken responses; phones provide reconnect-safe buzzers, Final Jeopardy wagers, and written final responses.

The clue source is [`jwolle1/jeopardy_clue_dataset`](https://github.com/jwolle1/jeopardy_clue_dataset). Its maintainer says the data belongs to Jeopardy Productions, Inc. and should not be used in a public-facing product. Keep this service on the private LAN and do not expose it through Funnel or a public reverse proxy.

## Prepare data

From the repository root:

```sh
chmod +x apps/jeopardy/scripts/fetch-clues.sh
apps/jeopardy/scripts/fetch-clues.sh data/jeopardy/clues.tsv
```

The downloaded Season 42 TSV is runtime data and is excluded from Git. The server groups clues by original air date and only offers episodes containing two complete six-category boards plus Final Jeopardy.

## Run

```sh
docker compose -f apps/jeopardy/compose.yaml config
docker compose -f apps/jeopardy/compose.yaml up -d --build
docker compose -f apps/jeopardy/compose.yaml ps
docker compose -f apps/jeopardy/compose.yaml logs --tail=100
```

Open `http://<server-LAN-IP>:8088` on the host display and choose **Host a game**. Players open the same address on their phones and enter the four-digit code. All devices must be on a network that can reach the server.

Game sessions live only in server memory. Restarting the container ends active games; no persistent player or game data is stored.

## Development

```sh
cd apps/jeopardy
npm ci
CLUE_FILE=../../data/jeopardy/clues.tsv npm start
npm test
```
