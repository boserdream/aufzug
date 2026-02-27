#!/bin/zsh
set -euo pipefail

SCRIPT="/Users/moritz/Documents/New project/tools/job_finder/run_daily_job_mail.sh"
LOG="/tmp/jobfinder_daily_run.log"

echo "== Job-Update gestartet: $(date '+%d.%m.%Y %H:%M:%S') =="
echo "Starte Mail-Lauf ..."

if /bin/zsh "$SCRIPT"; then
  echo "== Fertig: Mail-Lauf erfolgreich =="
else
  echo "== Fehler: Mail-Lauf fehlgeschlagen =="
  exit 1
fi

if [ -f "$LOG" ]; then
  echo
  echo "-- Letzte Log-Zeilen ($LOG) --"
  tail -n 20 "$LOG" || true
fi

echo
echo "== Ende: $(date '+%d.%m.%Y %H:%M:%S') =="
