# Lift Monitor (Berlin)

Benachrichtigt dich, wenn ein von dir beobachteter Aufzug bei `brokenlifts.org` kaputt geht oder wieder funktioniert.

## 1) Aufzüge konfigurieren

1. Datei kopieren:
   - `cp /Users/moritz/Documents/New\ project/tools/lift_monitor/config.example.json /Users/moritz/Documents/New\ project/tools/lift_monitor/config.json`
2. In `config.json` deine Aufzüge eintragen (`name` + `url`).
3. Die `url` sollte auf einen konkreten Aufzug zeigen, z. B.:
   - `https://www.brokenlifts.org/station/900100003/199`

## 2) Testlauf

```bash
/usr/bin/python3 /Users/moritz/Documents/New\ project/tools/lift_monitor/lift_monitor.py \
  --config /Users/moritz/Documents/New\ project/tools/lift_monitor/config.json \
  --state /Users/moritz/Documents/New\ project/tools/lift_monitor/state.json \
  --notify stdout
```

Danach mit macOS-Notification:

```bash
/usr/bin/python3 /Users/moritz/Documents/New\ project/tools/lift_monitor/lift_monitor.py \
  --config /Users/moritz/Documents/New\ project/tools/lift_monitor/config.json \
  --state /Users/moritz/Documents/New\ project/tools/lift_monitor/state.json \
  --notify osascript
```

## 3) Automatisch alle 5 Minuten (launchd)

Installieren/aktivieren:

```bash
cp /Users/moritz/Documents/New\ project/launchd/com.moritz.liftmonitor.plist ~/Library/LaunchAgents/com.moritz.liftmonitor.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.moritz.liftmonitor.plist >/dev/null 2>&1 || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.moritz.liftmonitor.plist
launchctl kickstart -k gui/$(id -u)/com.moritz.liftmonitor
```

Logs:
- `~/Library/Logs/liftmonitor.log`
- `~/Library/Logs/liftmonitor-error.log`

Stoppen:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.moritz.liftmonitor.plist
```

## 4) WhatsApp-Benachrichtigung (optional)

Im Block `whatsapp` in `config.json` eintragen:

```json
"whatsapp": {
  "enabled": true,
  "provider": "callmebot",
  "phone": "4917612345678",
  "apikey": "DEIN_CALLMEBOT_APIKEY"
}
```

- `phone`: im internationalen Format ohne `+` (z. B. `49...`).
- `apikey`: von CallMeBot.
- Wenn `enabled` auf `true` steht, sendet die App bei Statuswechsel zusätzlich zu Desktop-Notifications eine WhatsApp.

## 5) Cloud-Modus (GitHub Actions, Laptop kann aus sein)

Workflow:
- `/Users/moritz/Documents/New project/.github/workflows/lift-monitor-whatsapp.yml`

Script:
- `/Users/moritz/Documents/New project/tools/lift_monitor/cloud_lift_whatsapp.py`

Erforderliche GitHub Repository Secrets:
- `WHATSAPP_PHONE` (Format `49...` ohne `+`)
- `WHATSAPP_APIKEY` (CallMeBot API Key)

Ablauf:
1. Stelle sicher, dass deine Stationen in `tools/lift_monitor/config.json` (oder `config.example.json`) stehen.
2. Commit + push ins GitHub-Repo.
3. Workflow läuft automatisch alle 5 Minuten und sendet WhatsApp bei Statuswechsel.
4. Optional manuell testen in GitHub Actions per `workflow_dispatch` mit `dry_run=true`.
