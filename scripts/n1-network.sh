#!/usr/bin/env bash
# Acceptance test N-1 (spec 19, "Test"; spec 20): run a test command while logging every
# outbound connection attempt made by its whole process tree (the app, its WebKit
# helper processes, the driver), and fail if any goes anywhere but loopback.
#
# Linux implementation: strace follows every fork and records connect()/sendto()/
# sendmsg() with their socket addresses (this also catches DNS lookups). Unix-domain
# sockets (X11, D-Bus) are local IPC and ignored.
#
# Usage: scripts/n1-network.sh [command...]   (default: scripts/e2e.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
log=$(mktemp -t scrim-n1-XXXXXX.strace)
if [[ $# -eq 0 ]]; then set -- scripts/e2e.sh; fi

# Timing assertions are meaningless under strace; tests report them instead.
export SCRIM_UNDER_TRACE=1
status=0
strace -f -qq -s 0 -e trace=connect,sendto,sendmsg -e signal=none -o "$log" "$@" || status=$?

# Keep only internet-family addresses that are not loopback.
outbound=$(grep -E 'sa_family=AF_INET6?' "$log" \
  | grep -v -E 'inet_addr\("127\.[0-9.]+"\)|inet_pton\(AF_INET6, "::1"|inet_pton\(AF_INET6, "::ffff:127\.' \
  | grep -v -E 'inet_addr\("0\.0\.0\.0"\)' || true)
total=$(grep -c -E 'sa_family=AF_INET6?' "$log" || true)
echo "N-1: $total internet-family socket call(s) traced, log $log"
if [[ -n "$outbound" ]]; then
  echo "N-1 FAILED: outbound connections to non-loopback addresses:"
  echo "$outbound" | head -50
  exit 1
fi
echo "N-1 passed: no connections except loopback"
exit $status
