# Jeopardy changelog

## 2026-09-10

- Fixed a server crash when every eligible player answered a clue incorrectly.
  The automatic result transition had called a host-validated answer action
  from the `result` phase; it now uses a dedicated internal reveal transition.
  Added a regression test covering two consecutive wrong responses; all 24
  tests pass. Rebuilt/recreated only Jeopardy under the user's standing
  UI-deploy approval. The container is healthy with no restarts or OOM event
  since deployment, and the live game logic matches the tested local file.
  Rollback backup: `/Users/jack/Server/apps/jeopardy-crash-fix-backup.Ks1uPQ`.

- Updated the host clue card to measure its rendered content and automatically
  reduce clue/answer typography together until the category, clue, controls,
  and revealed answer fit within the available TV card height. Added resize
  handling and regression coverage; all 23 tests pass. Rebuilt and recreated
  only Jeopardy under the user's standing UI-deploy approval, clearing active
  in-memory games. The container is healthy with 131 games loaded and live
  assets match the tested local files. Rollback backup:
  `/Users/jack/Server/apps/jeopardy-clue-fit-backup.4ccu5L`.

- Refined the TV clue flow and layout. Enlarged clue categories and prompts,
  displayed revealed responses without a label at the same size as clues,
  simplified phone submission and host override labels, removed visible
  countdowns and the manual back-to-board action, and added a three-second
  automatic return after an unanswered reveal while retaining the five-second
  scored-result transition. Constrained the desktop host board and scores to
  one TV viewport without changing the mobile board layout. All 22 tests pass.
  Rebuilt/recreated only Jeopardy under the user's standing UI deployment
  approval, clearing active in-memory games. The container is healthy with 131
  games loaded and live files match the tested local files. Rollback backup:
  `/Users/jack/Server/apps/jeopardy-tv-flow-backup.WBVvjR`.

- Added the user-supplied `no_answer.mp3` and `final_jeopardy_music.mp3`. The
  host display now plays the first when an unanswered buzzer window reveals the
  response and plays Final Jeopardy music once while the final clue accepts
  responses; player phones do not play either sound. Added MP3 MIME handling
  and transition regression coverage; all 20 tests pass. Rebuilt/recreated only
  Jeopardy under the user's standing UI-deploy approval, clearing active
  in-memory games. The container is healthy with 131 games loaded, and live
  JS/audio match local files byte-for-byte. Rollback backup:
  `/Users/jack/Server/apps/jeopardy-audio-backup.CLPmLu`.

- Deployed the simplified landing page with the supplied logo, a `Host` button,
  and an automatically refreshed `Available Games` list with direct joining.
  Removed visible game codes, the manual code form, and the manual refresh
  control from the landing page. All 19 tests pass. Rebuilt and recreated only
  Jeopardy under the user's temporary standing approval for rapid UI redeploys;
  active in-memory games were cleared. The container is healthy with 131 games
  loaded, and served JS/CSS match local files byte-for-byte. Prior files for
  rollback: `/Users/jack/Server/apps/jeopardy-landing-backup.MJFNoO`.

- Deployed approved typography update from `work/jeopardy-ui`: bundled
  OFL-licensed Oswald and Libre Baskerville with license notices, local font
  preloads, TTF MIME support and responsive category sizing. All 19 local tests
  pass. Rebuilt/recreated only Jeopardy, clearing active games. Container
  healthy with 131 games loaded; served HTML, CSS and both fonts match local
  files byte-for-byte, with font/ttf responses. Not visually browser-verified.
  Prior source backup: `/Users/jack/Server/apps/jeopardy-font-backup.BYn0ga`.

- Deployed mobile header cleanup, faster clue-length countdown (4 words/second
  + 0.5 seconds, minimum 1.5 seconds), eight-second no-buzz timeout, automatic
  answer scoring and five-second result display, with host override available
  until the next buzz/clue/round or final wager. Final answers also score
  automatically with results-screen overrides. All 19 local tests passed.
  With approval, rebuilt/recreated only Jeopardy; health endpoint reports 131
  loaded games and served JS/CSS checksums match. Restart cleared active games.
  Prior source backup: `/Users/jack/Server/apps/jeopardy-scoring-backup.xsQHIZ`.

## 2026-09-08

- Deployed drawn-name onboarding, randomized first picker, phone board
  selection, word-count reading countdown with server-controlled buzzers and
  250 ms early lockout, typed responses with conservative soft-match
  suggestions and host-confirmed scoring, and phone Daily Double wagers.
  Removed hidden clue/answer data from public boards. All 14 local tests passed.
  With approval, rebuilt/recreated only Jeopardy; verified healthy status, 131
  loaded games, and served JavaScript checksum. Prior source backup:
  `/Users/jack/Server/apps/jeopardy-phone-backup.pc62b8`. Existing in-memory
  games were cleared by the restart.

- Fixed Jeopardy getting stuck on Connecting when restoring a game cleared by
  deployment. Failed session restoration now clears stale session references
  and returns to the welcome/discovery screen. Added regression tests for
  expired host and player sessions; all seven tests pass. Redeployed the
  Jeopardy Compose service.

- Added lobby discovery to the join screen, with player counts, five-second
  refresh, manual refresh, and code selection. Discovery exposes only lobby
  codes/counts for connected hosts with free slots; manual code joining remains
  available. Five local tests passed, including discovery filtering and secret
  exclusion; verified the deployed WebSocket discovery response. Redeployed
  only Jeopardy using Compose. Backup:
  `/Users/jack/Server/apps/jeopardy-discovery-backup.4n5Tb6`.

- Replaced text branding on the welcome, lobby, loading, and board screens with
  the supplied transparent PNG rendered white via CSS; removed the two
  homepage taglines. Redeployed the Jeopardy Compose service. Pre-change UI
  backup: `/Users/jack/Server/apps/jeopardy-ui-backup.2voCuy`.

- Updated the board, score panels, welcome form, and mobile styling in
  `/Users/jack/Server/apps/jeopardy/public`. With user approval, deployed using
  `docker compose up -d --build jeopardy` from its Compose directory. Container
  is healthy, all 131 playable games loaded, and served asset hashes match the
  locally tested source (four game tests passed). Original UI files are backed
  up at `/Users/jack/Server/apps/jeopardy-ui-backup.IMdEv3`; rollback consists
  of restoring those files and rebuilding the same service. Recreation clears
  in-memory games; the read-only clue dataset was preserved.
