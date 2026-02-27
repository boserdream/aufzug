# Cineby Beamer Player

Kleine Electron-Kiosk-App, die direkt `https://cineby.app` im Vollbild startet.

## Setup
1. Node.js installieren (empfohlen: aktuelle LTS).
2. Im Projektordner ausführen:
   - `npm install`

## Start
- Standard (lädt `https://cineby.app`):
  - `npm start`
- Eigene URL:
  - `CINEBY_URL='https://cineby.app' npm run start:url`

## Bedienung
- `F11`: Kiosk-Modus an/aus
- `Cmd/Ctrl + R`: neu laden
- `Cmd/Ctrl + Q`: App beenden

## Beamer-Hinweise
- Beamer per HDMI als Haupt- oder erweiterten Bildschirm nutzen.
- In den OS-Anzeigeeinstellungen die richtige Auflösung/Hz setzen.
- Für Streaming-DRM immer aktuelle Browser-Engine/GPU-Treiber nutzen.

## Job Finder (Stellenangebote)
- Eingebaute Quellen:
  - `https://www.arbeitnow.com/` (API)
  - `https://remotive.com/` (API)
  - `https://gesinesjobtipps.de/`
  - `https://interamt.de/koop/app/trefferliste?5`
  - `https://bund.service.de/` / `https://service.bund.de/`
  - `https://www.bundeswirtschaftsministerium.de/Navigation/DE/Ministerium/Stellenangebote/stellenangebote.html`
  - `https://www.bundesgesundheitsministerium.de/ministerium/karriere/stellenangebote`
  - `https://www.bmi.bund.de/DE/service/stellenangebote/stellenangebote-node.html`
  - `https://www.bmbfsfj.bund.de/bmbfsfj/ministerium/bmbfsfj-als-arbeitgeber/ausschreibungen`
  - `https://bmds.bund.de/ministerium/bmds-als-arbeitgeber`
  - `https://www.bundesfinanzministerium.de/Web/DE/Ministerium/Arbeiten-Ausbildung/Stellenangebote/stellenangebote.html`
  - `https://www.stepstone.de/`
- Konfigurationsprofil anpassen:
  - Persönlich (auf Moritz Frisch angepasst): `tools/job_finder/job_profile.moritzfrisch.json`
  - Vorlage: `tools/job_finder/job_profile.example.json`
- Suche starten:
  - `npm run jobs:find`
- Suche mit Vorlage:
  - `npm run jobs:find:example`
- Mit Datei-Ausgabe:
  - `node tools/job_finder/job_finder.mjs --config tools/job_finder/job_profile.moritzfrisch.json --out /tmp/jobs.md --json /tmp/jobs.json`
- Daily Mail:
  - Skript: `tools/job_finder/run_daily_job_mail.sh`
  - LaunchAgent: `launchd/com.moritz.jobfinder.daily.plist` (taeglich 08:00 Uhr)

## Cloud-Automation (ohne laufenden Laptop)
- Workflow: `.github/workflows/job-update-email.yml`
- Mailer: `tools/job_finder/cloud_job_mailer.py`
- Ablauf:
  - GitHub Actions laeuft stündlich (`cron`), sendet aber nur um `08:00 Europe/Berlin`.
  - Optional sofortiger Versand via `workflow_dispatch` mit `force_send=true`.
- Erforderliche GitHub Repository Secrets:
  - `SMTP_HOST` (z. B. `mail.gmx.net`)
  - `SMTP_PORT` (z. B. `587`)
  - `SMTP_USERNAME`
  - `SMTP_PASSWORD`
  - `SMTP_USE_STARTTLS` (`true`/`false`)
  - `MAIL_FROM` (Absenderadresse)
  - `MAIL_TO` (Empfängeradresse, z. B. `moritzfrisch@gmx.net`)

## Notion Dashboard automatisch erstellen
- Script: `/Users/moritz/Documents/New project/tools/notion/create_dashboard.mjs`
- Zweck: Erstellt eine Dashboard-Startseite plus Datenbanken (`Bewerbungen`, `Aufgaben`, `Termine`, `Notizen`) per Notion API.

### 1) Notion vorbereiten
- Unter [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations) eine Integration erstellen.
- Den `Internal Integration Token` kopieren (`secret_...`).
- In Notion die Seite oeffnen, unter der das Dashboard erstellt werden soll.
- Auf dieser Seite: `Share` -> Integration einladen (deine neue Integration).

### 2) Script ausfuehren
```bash
cd '/Users/moritz/Documents/New project'
NOTION_TOKEN='secret_xxx' npm run notion:dashboard -- --parent 'https://www.notion.so/...'
```

Optional mit eigenem Titel:
```bash
NOTION_TOKEN='secret_xxx' npm run notion:dashboard -- --parent 'https://www.notion.so/...' --title 'Moritz OS'
```

Hinweis: Gespeicherte Datenbank-Views (z. B. \"Heute\", \"Pipeline\", \"Follow-up\") setzt du in Notion danach einmal manuell.

## Dateien automatisch umbenennen
- Script: `/Users/moritz/Documents/New project/tools/auto_rename.py`
- Zweck: Liest Dateien in einem Ordner aus und benennt sie automatisch um.
- Standard:
  - `python3 tools/auto_rename.py --dir "/pfad/zum/ordner" --dry-run`
- Wirklich umbenennen:
  - `python3 tools/auto_rename.py --dir "/pfad/zum/ordner"`
- Alle Dateien umbenennen (nicht nur generische Namen wie `scan`, `img`, `untitled`):
  - `python3 tools/auto_rename.py --dir "/pfad/zum/ordner" --all`
- Eigenes Namensschema:
  - `python3 tools/auto_rename.py --dir "/pfad/zum/ordner" --pattern "{date}_{index}_{stem}"`

## Aufzugs-Monitor (Berlin)
- Script: `/Users/moritz/Documents/New project/tools/lift_monitor/lift_monitor.py`
- Zweck: Ueberwacht von dir konfigurierte Aufzuege (brokenlifts.org) und meldet Statuswechsel:
  - kaputt (`Außer Betrieb`)
  - wieder verfuegbar (`Der Aufzug steht zur Verfügung.`)
- Einrichtung und LaunchAgent:
  - `/Users/moritz/Documents/New project/tools/lift_monitor/README.md`
- Desktop-App mit Statusanzeige und Aufzug-Verwaltung:
  - Start: `npm run lift:desktop`
  - Dateien: `/Users/moritz/Documents/New project/lift-monitor/`
  - Optional WhatsApp-Benachrichtigung:
    - In `tools/lift_monitor/config.json` Block `whatsapp` aktivieren (`enabled: true`) und `phone` + `apikey` eintragen (CallMeBot).
  - Cloud-Überwachung (läuft ohne eingeschalteten Laptop):
    - Workflow: `.github/workflows/lift-monitor-whatsapp.yml`
    - Benötigte Secrets: `WHATSAPP_PHONE`, `WHATSAPP_APIKEY`
