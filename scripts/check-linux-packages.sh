#!/usr/bin/env bash
# P8-1 on Linux, automated: the release .deb installs, registers for Markdown, launches
# with a file (S-1 against the installed binary), and uninstalls without leaving files;
# the AppImage opens a file too. Run after `npx tauri build --bundles deb appimage`.
# Needs root (or sudo), xvfb-run, dbus-run-session and tauri-driver, as scripts/e2e.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO=sudo
deb=$(ls target/release/bundle/deb/*.deb | head -1)
appimage=$(ls target/release/bundle/appimage/*.AppImage | head -1)
fail() { echo "check-linux-packages: $*" >&2; exit 1; }

echo "== $deb"
grep -q libwebkit2gtk-4.1 <<<"$(dpkg-deb -f "$deb" Depends)" || fail "Depends lacks libwebkit2gtk-4.1"
grep -q hunspell-en-us <<<"$(dpkg-deb -f "$deb" Recommends)" || fail "Recommends lacks hunspell-en-us"
# Regular files only, as absolute paths.
files=$(dpkg-deb -c "$deb" | awk '$1 !~ /^d/ {print $6}' | sed -E 's|^\.?/?|/|')
$SUDO apt-get install -y -q "./$deb" 2>&1 | tail -3
test -x /usr/bin/scrim || fail "/usr/bin/scrim missing after install"
desktop=$(echo "$files" | grep "^/usr/share/applications/.*\.desktop$" | head -1)
[ -n "$desktop" ] || fail "no desktop file in the package"
grep -q '^Exec=scrim %F$' "$desktop" || fail "desktop file: Exec is not 'scrim %F'"
grep -q '^MimeType=.*text/markdown;' "$desktop" || fail "desktop file: no text/markdown"
command -v update-desktop-database >/dev/null || $SUDO apt-get install -y -q desktop-file-utils >/dev/null
$SUDO update-desktop-database -q /usr/share/applications
if command -v gio >/dev/null; then
  mime=$(gio mime text/markdown 2>/dev/null || true)
  grep -q "$(basename "$desktop")" <<<"$mime" || fail "gio does not list $(basename "$desktop") for text/markdown"
fi

echo "== S-1 against the installed binary"
SCRIM_APP=/usr/bin/scrim SCRIM_SKIP_BUILD=1 SCRIM_E2E_FILTER='^S-1 ' scripts/e2e.sh || fail "S-1 failed with /usr/bin/scrim"

echo "== S-1 against the AppImage"
chmod +x "$appimage"
APPIMAGE_EXTRACT_AND_RUN=1 SCRIM_APP="$(pwd)/$appimage" SCRIM_SKIP_BUILD=1 SCRIM_E2E_FILTER='^S-1 ' scripts/e2e.sh || fail "S-1 failed with the AppImage"

echo "== uninstall"
$SUDO dpkg -r scrim >/dev/null
left=""
for f in $files; do [ -e "$f" ] && left="$left $f"; done
[ -z "$left" ] || fail "left behind after dpkg -r:$left"
echo "check-linux-packages: ok"
