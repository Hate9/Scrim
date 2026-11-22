#!/usr/bin/env bash
# Runs inside the private D-Bus session of scripts/e2e.sh: the tests, then every process
# that bus activated for them. Desktop services (for example xdg-desktop-portal-kde on
# KDE) are started on the private bus, inherit the run's stdout, and would otherwise
# keep running after it, so `scripts/e2e.sh | tail` never finished.
set -uo pipefail
node tests/e2e/run.mjs "$@"
code=$?
stop_bus_services() {
  local self=$$ pids=() p pid comm
  for p in /proc/[0-9]*; do
    pid=${p#/proc/}
    [[ $pid == "$self" ]] && continue
    # Processes of this private session carry its bus address in their environment.
    grep -qzxF "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS" "$p/environ" 2>/dev/null || continue
    comm=$(cat "$p/comm" 2>/dev/null) || continue
    # The bus itself ends with dbus-run-session; this script's own helpers end by themselves.
    [[ $comm == dbus-daemon || $comm == grep || $comm == cat ]] && continue
    pids+=("$pid")
  done
  ((${#pids[@]})) || return 0
  echo "e2e: stopping ${#pids[@]} process(es) the private bus started: $(for q in "${pids[@]}"; do cat "/proc/$q/comm" 2>/dev/null; done | sort -u | tr '\n' ' ')" >&2
  kill "${pids[@]}" 2>/dev/null
  sleep 1
  kill -9 "${pids[@]}" 2>/dev/null
  return 0
}
stop_bus_services
exit $code
