# Bewerbungs-Tool (wiederverwendbar)

## Zweck
Erstellt aus einer JSON-Konfiguration automatisch:
- Anschreiben als PDF (Arial 10, Betreff fett, optional Blocksatz)
- Gesamt-PDF(s) mit Anlagen
- optional Apple-Mail-Entwurf mit Anhang

## Nutzung
1. JSON aus `tools/bewerbung/examples/template.json` kopieren und ausfüllen.
2. Build + Erstellung:
   - `tools/bewerbung/run_application.sh /pfad/zur/config.json`
3. Mit Mail-Entwurf:
   - `tools/bewerbung/run_application.sh /pfad/zur/config.json --open-draft`

## Wichtige Felder
- `output_dir`: Zielordner
- `paragraphs`: Kerntext des Anschreibens
- `attachments_full`: Anlagen für vollständige PDF
- `compact_pdf` + `attachments_compact`: optionale kleine Versandversion
- `email_to`, `email_subject`, `email_body`, `email_attachment`: für Entwurf

## Hinweis
Wenn `signature_path` gesetzt ist und die Datei existiert, wird sie ins Anschreiben eingebettet.
