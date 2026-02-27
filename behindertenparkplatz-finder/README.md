# Behindertenparkplatz-Finder Berlin

Lokale Web-App mit Eingabemaske:
- Zieladresse in Berlin eingeben
- Suchradius auswählen
- nächstgelegenen Behindertenparkplatz anzeigen lassen
- Start/Ziel als Route eingeben
- Aufzugsstörungen entlang der Route prüfen (Live-Hinweise)
- Optional Zwischenhalte pro Zeile eingeben, um deine reale Strecke abschnittsweise zu prüfen

## Start als Desktop-Programm

1. Im Projektordner ausführen:
   - `npm run parking:desktop`
2. In der App Zieladresse eingeben und auf `Nächsten Parkplatz finden` klicken.

## macOS .app Bundle (ohne Terminal)

1. Bundle bauen:
   - `./behindertenparkplatz-finder/build-macos-app.sh`
2. Danach per Doppelklick starten:
   - `/Users/moritz/Documents/New project/behindertenparkplatz-finder/dist/Behindertenparkplatz-Finder.app`

## macOS DMG Paket

1. DMG bauen:
   - `./behindertenparkplatz-finder/build-dmg.sh`
2. Ergebnis:
   - `/Users/moritz/Documents/New project/behindertenparkplatz-finder/dist/Behindertenparkplatz-Finder-Berlin.dmg`

## Start als Browser-Variante

- Datei `index.html` direkt im Browser öffnen.

## Datenquellen

- Geocoding: OpenStreetMap Nominatim
- Parkplatzdaten (kombiniert):
  - OpenStreetMap Overpass API
  - Berlin Open Data WFS (`gdi.berlin.de`, Layer Behindertenparkplätze)
- Routen- und Störungshinweise:
  - VBB Transport REST (`v6.vbb.transport.rest`, Journey-Remarks)
  - Verlinkung zu BrokenLifts pro Halt (falls Stations-ID vorhanden)

Hinweis: Die Daten sind Community-basiert (OSM) und können unvollständig sein.

## Abdeckung und Grenzen

- Die Suche kombiniert OSM + Berlin Open Data.
- Wenn lokal zu wenige Treffer vorhanden sind, wird automatisch ein berlinweiter Amtsdaten-Fallback geladen.
- Trotzdem kann es fehlende Plätze geben (z. B. nicht gemappt, verzögert aktualisiert, private Flächen).
- Aufzugsstatus auf Route basiert auf Live-Hinweisen der abgefragten Journey und kann unvollständig sein.
