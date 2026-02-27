#!/bin/zsh
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <config.json> [--open-draft]"
  exit 1
fi

CFG="$1"
OPEN_DRAFT="${2:-}"
ROOT='/Users/moritz/Documents/New project'
BIN='/tmp/build_application_from_json'
SRC="$ROOT/tools/bewerbung/build_application_from_json.m"

clang -framework Foundation -framework AppKit -framework PDFKit "$SRC" -o "$BIN"
"$BIN" "$CFG"

if [ "$OPEN_DRAFT" = "--open-draft" ]; then
  /usr/bin/python3 - "$CFG" << 'PY'
import json, subprocess, sys, os
cfg=json.load(open(sys.argv[1], encoding='utf-8'))
out=cfg.get('output_dir','.')
to=cfg.get('email_to','')
subject=cfg.get('email_subject','Bewerbung')
body=cfg.get('email_body','Sehr geehrte Damen und Herren,\n\nim Anhang finden Sie meine Bewerbungsunterlagen.\n')
attachment=cfg.get('email_attachment','')
if not to or not attachment:
    print('email_to/email_attachment fehlen im config')
    sys.exit(0)
if not os.path.isabs(attachment):
    attachment=os.path.join(out, attachment)

def esc(s):
    return s.replace('\\','\\\\').replace('"','\\"').replace('\n','\\n')
cmd=[
    'osascript',
    '-e','tell application "Mail"',
    '-e',f'set draftMsg to make new outgoing message with properties {{visible:true, subject:"{esc(subject)}", content:"{esc(body)}"}}',
    '-e','tell draftMsg',
    '-e',f'make new to recipient at end of to recipients with properties {{address:"{esc(to)}"}}',
    '-e',f'make new attachment with properties {{file name:POSIX file "{esc(attachment)}"}} at after the last paragraph',
    '-e','end tell',
    '-e','activate',
    '-e','end tell'
]
subprocess.run(cmd, check=True)
PY
fi
