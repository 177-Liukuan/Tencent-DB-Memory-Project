#!/usr/bin/env bash
set -euo pipefail
env="${1:-staging}"
echo "planning deployment for ${env}"
docker compose config >/dev/null
