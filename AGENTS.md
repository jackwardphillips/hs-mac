This machine hosts long-running services. Prioritize reliability over speed.

## General

- Don't assume. Don't hide confusion. Surface tradeoffs. If uncertain, ask.
- If multiple interpretations exist, present them. Don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## Principles

- Make the smallest change that solves the problem.
- Explain your plan before making significant changes.
- Ask before performing destructive actions.
- Match the existing project structure and tooling.
- Log fleet-wide operational changes in `waxwing:/home/jack/server/CHANGELOG.md`.

## Safety

Never, without explicit approval:
- Delete data, volumes, or databases.
- Reset or recreate containers if data may be lost.
- Modify `.env` files containing secrets.
- Open firewall ports or weaken security.
- Install system packages unrelated to the task.

## Docker

- Prefer `docker compose` over manual `docker run`.
- Preserve persistent volumes.
- After changes, verify the affected service is healthy.
- Check logs when troubleshooting instead of guessing.

## Git

- Prefer `git pull --ff-only`.
- Never force-push or rewrite history unless requested.
- Keep commits focused on the requested change.