#!/usr/bin/env bash
# Run the end-to-end tests under a virtual X display and a private D-Bus session bus.
# Usage: scripts/e2e.sh            (builds the debug app first)
#        SCRIM_SKIP_BUILD=1 scripts/e2e.sh
#        SCRIM_E2E_FILTER='^T-' scripts/e2e.sh   (regex on test names)
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${SCRIM_SKIP_BUILD:-}" ]]; then
  npx tauri build --debug --no-bundle
fi
run() {
  if [[ -z "${DISPLAY:-}" ]]; then
    exec xvfb-run -a -s "-screen 0 1280x900x24" "$@"
  else
    exec "$@"
  fi
}
run dbus-run-session -- scripts/e2e-session.sh ${SCRIM_E2E_FILTER:+"$SCRIM_E2E_FILTER"}
