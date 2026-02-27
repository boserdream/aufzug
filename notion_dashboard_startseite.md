# Dashboard Startseite (Notion)

> Titelvorschlag: **Moritz OS**
> Icon: 🎯
> Cover: dezentes Foto/Gradient

---

## 1) Header-Bereich (oben auf der Seite)

**Quote Callout**

"Fokus: 3 wichtigste Dinge heute erledigen."

**Schnellaktionen** (als Buttons oder verlinkte Unterseiten)
- ➕ Neue Bewerbung
- ✅ Neue Aufgabe
- 📅 Termin eintragen
- 📝 Notiz erfassen

---

## 2) Layout in 3 Spalten

### Spalte 1: Heute

#### A) Tagesfokus
- `Top 3` (einfach als Checkliste)
- `Deep Work Block` (z. B. 09:00-11:00)

#### B) Heute fällig (Aufgaben-View)
**Datenbank:** `Aufgaben`
**View-Filter:**
- Status ist nicht `Erledigt`
- Fälligkeitsdatum ist `today`
**Sortierung:** Priorität absteigend, dann Uhrzeit aufsteigend

#### C) Nächster Termin (Kalender-View)
**Datenbank:** `Termine`
**Filter:** Datum ist innerhalb der nächsten 7 Tage

---

### Spalte 2: Bewerbungs-Hub

#### A) Pipeline-Board
**Datenbank:** `Bewerbungen`
**View:** Board gruppiert nach `Status`
**Status-Optionen:**
- Idee
- In Vorbereitung
- Versendet
- Interview
- Angebot
- Absage

#### B) Follow-ups diese Woche
**View-Filter:**
- Status ist `Versendet` oder `Interview`
- Follow-up Datum ist innerhalb der nächsten 7 Tage

#### C) Kennzahlen (kleine Galerie oder Number-Properties)
- Offene Bewerbungen
- Interviews diese Woche
- Antworten ausstehend (>10 Tage)

---

### Spalte 3: Wissen & Admin

#### A) Notizen-Inbox
**Datenbank:** `Notizen`
**Filter:** Kategorie ist `Inbox`

#### B) Dokumente
Unterseiten/Links:
- Lebenslauf
- Anschreiben Vorlagen
- Zeugnisse
- Bewerbungs-Assets

#### C) Wochenreview
Checkliste:
- Was lief gut?
- Was blockiert?
- Nächste Woche Top 3

---

## 3) Benötigte Datenbanken (einmalig anlegen)

### Datenbank: Bewerbungen
**Properties:**
- `Firma` (Title)
- `Rolle` (Text)
- `Status` (Select: Idee, In Vorbereitung, Versendet, Interview, Angebot, Absage)
- `Bewerbungsdatum` (Date)
- `Follow-up` (Date)
- `Quelle` (Select: LinkedIn, StepStone, Karriereportal, Netzwerk, Sonstiges)
- `Priorität` (Select: Hoch, Mittel, Niedrig)
- `Unterlagen vollständig` (Checkbox)
- `Link` (URL)
- `Notizen` (Text)

### Datenbank: Aufgaben
**Properties:**
- `Aufgabe` (Title)
- `Status` (Select: Offen, In Arbeit, Warten, Erledigt)
- `Priorität` (Select: Hoch, Mittel, Niedrig)
- `Fällig` (Date)
- `Bereich` (Select: Bewerbung, Admin, Lernen, Privat)
- `Bezug Bewerbung` (Relation -> Bewerbungen)

### Datenbank: Termine
**Properties:**
- `Termin` (Title)
- `Datum` (Date inkl. Uhrzeit)
- `Typ` (Select: Interview, Telefonat, Deadline, Sonstiges)
- `Firma` (Relation -> Bewerbungen)
- `Notizen` (Text)

### Datenbank: Notizen
**Properties:**
- `Titel` (Title)
- `Kategorie` (Select: Inbox, Bewerbung, Idee, Journal, Lernen)
- `Erstellt` (Created time)
- `Bezug Bewerbung` (Relation -> Bewerbungen)

---

## 4) Praktische Standard-Views

### Bewerbungen
- `Pipeline` (Board nach Status)
- `Diese Woche` (Filter: Bewerbungsdatum in dieser Woche)
- `Warten auf Antwort` (Filter: Status = Versendet, Bewerbungsdatum älter als 10 Tage)

### Aufgaben
- `Heute`
- `Diese Woche`
- `Backlog`

### Termine
- `Kalender`
- `Nächste 7 Tage`

---

## 5) Start in 10 Minuten

1. Neue Notion-Seite erstellen: `Dashboard`.
2. 3-Spalten-Layout ziehen.
3. Vier Datenbanken als Full Page erstellen (`Bewerbungen`, `Aufgaben`, `Termine`, `Notizen`).
4. Zurück auf `Dashboard` und jede DB als Linked View einfügen.
5. Obige Filter/Sortierungen setzen.
6. Schnellaktionen als Buttons oder verlinkte Unterseiten ergänzen.
7. Favorit markieren und als Startseite anpinnen.

---

## 6) Optional: Persönliche Veredelung

- Farbcodierung: `Hoch` = Rot, `Mittel` = Gelb, `Niedrig` = Grau
- Eine "Daily Note"-Vorlage mit Datum + Top 3 + Reflexion
- Ein "Bewerbung erstellt"-Template in der Bewerbungen-DB:
  - Standard-Status = `In Vorbereitung`
  - Aufgaben automatisch anlegen (Anschreiben, CV-Check, Versand, Follow-up)

