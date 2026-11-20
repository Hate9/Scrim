#!/usr/bin/env bash
# N-1 / P8-1 CI check (spec 19, "Enforcement" item 4): the Rust side has no HTTP client
# crate. Checks the resolved dependency graph for each shipping target.
#
# Allowlist: crates pulled in only by Tauri itself and verified unused at runtime. Empty
# today: tauri 2 depends on reqwest only for Android/iOS targets (dev-server proxy).
set -euo pipefail
cd "$(dirname "$0")/.."

FORBIDDEN='reqwest|hyper|hyper-util|ureq|isahc|curl|curl-sys|attohttpc|surf|minreq'
ALLOWLIST=''   # e.g. 'hyper' (space separated), each with a note in DESIGN.md
TARGETS=(x86_64-unknown-linux-gnu x86_64-pc-windows-msvc)

fail=0
for target in "${TARGETS[@]}"; do
  found=$(cargo tree --workspace -e normal,build --prefix none --target "$target" \
    | sed 's/ v[0-9].*//' | sort -u | grep -E -x "$FORBIDDEN" || true)
  for crate in $found; do
    if [[ " $ALLOWLIST " == *" $crate "* ]]; then
      echo "allowlisted: $crate ($target)"
    else
      echo "FORBIDDEN HTTP client crate on $target: $crate"
      cargo tree --workspace -e normal --target "$target" -i "$crate" | head -20
      fail=1
    fi
  done
done
if [[ $fail == 0 ]]; then echo "no HTTP client crates on: ${TARGETS[*]}"; fi
exit $fail
