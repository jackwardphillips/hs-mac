#!/bin/bash
set -euo pipefail

exec /usr/bin/docker run --rm --network none \
  --user "$(id -u):$(id -g)" \
  --volume /home/jack:/home/jack \
  --workdir "${PWD}" \
  node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 node "$@"
