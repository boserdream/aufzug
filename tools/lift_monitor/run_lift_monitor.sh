#!/bin/zsh
set -euo pipefail

ROOT="/Users/moritz/Documents/New project"
SCRIPT="$ROOT/tools/lift_monitor/lift_monitor.py"
CONFIG="$ROOT/tools/lift_monitor/config.json"
STATE="$ROOT/tools/lift_monitor/state.json"

if [[ ! -f "$CONFIG" ]]; then
  CONFIG="$ROOT/tools/lift_monitor/config.example.json"
fi

/usr/bin/python3 "$SCRIPT" --config "$CONFIG" --state "$STATE" --notify osascript
