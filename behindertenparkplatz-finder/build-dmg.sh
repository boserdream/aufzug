#!/bin/zsh
set -euo pipefail

ROOT="/Users/moritz/Documents/New project"
APP_DIR="$ROOT/behindertenparkplatz-finder"
DIST_DIR="$APP_DIR/dist"
APP_NAME="Behindertenparkplatz-Finder.app"
APP_PATH="$DIST_DIR/$APP_NAME"
DMG_NAME="Behindertenparkplatz-Finder-Berlin.dmg"
DMG_PATH="$DIST_DIR/$DMG_NAME"
STAGING="$DIST_DIR/dmg-staging"

if [[ ! -d "$APP_PATH" ]]; then
  echo "App-Bundle fehlt: $APP_PATH" >&2
  echo "Bitte zuerst ./behindertenparkplatz-finder/build-macos-app.sh ausführen." >&2
  exit 1
fi

rm -rf "$STAGING"
mkdir -p "$STAGING"

cp -R "$APP_PATH" "$STAGING/$APP_NAME"
ln -s /Applications "$STAGING/Applications"

rm -f "$DMG_PATH"
xattr -cr "$STAGING" >/dev/null 2>&1 || true

hdiutil create \
  -volname "Behindertenparkplatz-Finder" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDZO \
  "$DMG_PATH" >/dev/null

rm -rf "$STAGING"

echo "DMG erstellt: $DMG_PATH"
