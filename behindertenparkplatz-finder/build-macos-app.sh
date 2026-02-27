#!/bin/zsh
set -euo pipefail

ROOT="/Users/moritz/Documents/New project"
APP_DIR="$ROOT/behindertenparkplatz-finder"
ELECTRON_BIN="$ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
DIST_DIR="$APP_DIR/dist"
APP_NAME="Behindertenparkplatz-Finder.app"
APP_PATH="$DIST_DIR/$APP_NAME"

if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "Electron binary nicht gefunden: $ELECTRON_BIN" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"
quote_for_sh() {
  local value="$1"
  value="${value//\'/\'\"\'\"\'}"
  printf "'%s'" "$value"
}

ELECTRON_SH_QUOTED="$(quote_for_sh "$ELECTRON_BIN")"
APP_DIR_SH_QUOTED="$(quote_for_sh "$APP_DIR")"
SCRIPT_PATH="$DIST_DIR/launcher.js"
COMMAND="$ELECTRON_SH_QUOTED $APP_DIR_SH_QUOTED >/tmp/behindertenparkplatz-finder.log 2>&1 &"

cat > "$SCRIPT_PATH" <<JS
var app = Application.currentApplication();
app.includeStandardAdditions = true;
app.doShellScript("$COMMAND");
JS

rm -rf "$APP_PATH"
xattr -cr "$DIST_DIR" >/dev/null 2>&1 || true
osacompile -l JavaScript -o "$APP_PATH" "$SCRIPT_PATH"

echo "App erstellt: $APP_PATH"
