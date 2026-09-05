    #!/usr/bin/env bash
    set -euo pipefail
    action="${1:-plan}"
    case "$action" in
      plan) node scripts/release-plan.mjs ;;
      package) mkdir -p build && printf '{"artifact":"checkout-service"}
' > build/artifact.json ;;
      *) echo "unknown action: $action" >&2; exit 2 ;;
    esac
