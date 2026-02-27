#!/usr/bin/env python3
import argparse
import datetime as dt
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}

GENERIC_PATTERNS = [
    re.compile(r"^scan", re.IGNORECASE),
    re.compile(r"^img", re.IGNORECASE),
    re.compile(r"^image", re.IGNORECASE),
    re.compile(r"^dokument", re.IGNORECASE),
    re.compile(r"^document", re.IGNORECASE),
    re.compile(r"^untitled", re.IGNORECASE),
    re.compile(r"^rechnung", re.IGNORECASE),
]

NOISE_WORDS = {
    "rechnung", "invoice", "rechnungsnummer", "rechnungsnr", "steuer", "ust", "mwst", "summe",
    "kunde", "kundennummer", "bestellnummer", "vertrag", "agreement", "seite", "page", "datum",
    "total", "euro", "eur", "www", "http", "iban", "bic", "zahlbar", "faellig", "ust-id",
    "inkl", "exkl", "brutto", "netto", "betrag", "gesamt", "beleg", "document", "dokument",
}

FILENAME_NOISE = {
    "scan", "document", "dokument", "img", "image", "untitled", "pdf", "unbekannt", "stichwort",
    "datei", "rechnung", "beleg", "vertrag",
}

PRIORITY_TERMS = [
    "familienkasse", "beitragsservice", "rundfunkbeitrag", "kostenerstattung",
    "verhinderungspflege", "bescheinigung", "antrag", "kuendigung", "vertrag", "rechnung", "beleg",
]

SUBJECT_MAP: list[tuple[str, str]] = [
    (r"\bbewilligungsbescheid\b", "Bewilligungsbescheid"),
    (r"\bschriftliche\s+verwarnung\b", "Verwarnung"),
    (r"\bverwarnungsgeld\b", "Verwarnung"),
    (r"\berwerbslosigkeit\b", "Erwerbslosigkeit"),
    (r"\bmitgliedsbeitrag\b", "Mitgliedsbeitrag"),
    (r"\brenteninformation\b", "Renteninformation"),
    (r"\bkostenerstattung\b", "Kostenerstattung"),
    (r"\bkennwortbrief\b", "Kennwortbrief"),
    (r"\bzugangsdaten\b", "Zugangsdaten"),
    (r"\bbenutzernamen?\s+und\s+kennw[oö]rter\b", "Zugangsdaten"),
    (r"\bbeitragsrechnung\b", "Beitragsrechnung"),
    (r"\bkfz[-\s]?versicherung\b", "Kfz_Versicherung"),
    (r"\bit[-\s]?servicedesk\b", "IT_Servicedesk"),
]

ORGANIZATION_PATTERNS: list[tuple[str, tuple[str, ...]]] = [
    ("Polizei_Berlin", ("polizei berlin", "bussgeldstelle", "bußgeldstelle")),
    ("verdi", ("ver.di", "vereinte dienstleistungsgewerkschaft", "verdi")),
    ("Bundesagentur_Arbeit", ("bundesagentur für arbeit", "bundesagentur fuer arbeit", "agentur für arbeit", "agentur fuer arbeit", "arbeitsagentur")),
    ("WBM", ("wbm", "wohnungsbaugesellschaft berlin-mitte", "wbm gmbh")),
    ("IHK", ("ihk", "industrie- und handelskammer")),
    ("AOK", ("aok", "gesundheitskasse")),
    ("DEVK", ("devk",)),
    ("Deutsche_Rentenversicherung", ("deutsche rentenversicherung", "knappschaft-bahn-see", "knappschaft bahn see")),
]

SUBJECT_STOPWORDS = {
    "der", "die", "das", "den", "dem", "des", "und", "oder", "mit", "fuer", "für", "zur", "zum",
    "vom", "von", "im", "in", "am", "an", "zu", "ihrer", "ihre", "ihren", "ihrem", "ihr", "einer",
    "einen", "einem", "eines", "dieser", "diese", "dieses", "betreff", "gegenstand", "subject",
}

ORGANIZATION_HINTS = {
    "versicherung", "krankenkasse", "rentenversicherung", "bank", "sparkasse", "kasse", "ihk",
    "knappschaft", "amt", "ministerium", "stiftung", "verein", "gmbh", "ag", "eg", "ev",
}

ORG_NOISE_WORDS = {
    "postanschrift", "telefon", "fax", "e-mail", "email", "datum", "herr", "herrn", "frau",
    "sehr", "geehrter", "mit", "freundlichen", "grussen", "grueßen", "zeichen", "aktenzeichen",
    "bearbeiter", "bearbeiterin", "internet", "seite", "unterschrift", "im", "auftrag",
}

OCR_CHAR_MAP = str.maketrans({
    "0": "o",
    "1": "i",
    "5": "s",
    "|": "i",
    "!": "i",
})

DOCUMENT_TYPE_PATTERNS: list[tuple[str, tuple[str, ...]]] = [
    ("Rechnung", ("rechnung", "invoice", "zahlbar", "rechnungsnummer", "kundennummer", "mwst", "umsatzsteuer")),
    ("Vertrag", ("vertrag", "agreement", "laufzeit", "kuendigung", "vertragsnummer")),
    ("Zugangsdaten", ("kennwort", "kennwoerter", "kennwörter", "benutzername", "passwort", "anmeldung", "mfa")),
    ("Mahnung", ("mahnung", "zahlungserinnerung", "letzte mahnung", "verzug")),
    ("Bescheid", ("bescheid", "bewilligung", "ablehnung", "verwaltungsakt")),
    ("Antrag", ("antrag", "beantrage", "beantragung", "antragsnummer")),
    ("Kontoauszug", ("kontoauszug", "kontostand", "saldo", "iban", "bic")),
    ("Lohnabrechnung", ("lohnabrechnung", "gehaltsabrechnung", "entgeltabrechnung", "arbeitgeber")),
    ("Arztbrief", ("arztbrief", "diagnose", "patient", "behandlung", "krankenkasse")),
]

MONTHS = {
    "jan": 1, "januar": 1, "january": 1,
    "feb": 2, "februar": 2, "february": 2,
    "mar": 3, "maerz": 3, "märz": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5, "mai": 5,
    "jun": 6, "juni": 6, "june": 6,
    "jul": 7, "juli": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "okt": 10, "october": 10, "oktober": 10,
    "nov": 11, "november": 11,
    "dec": 12, "dez": 12, "december": 12, "dezember": 12,
}


def resolve_tool(name: str) -> Optional[str]:
    found = shutil.which(name)
    if found:
        return found
    for candidate in (f"/opt/homebrew/bin/{name}", f"/usr/local/bin/{name}", f"/usr/bin/{name}"):
        if Path(candidate).exists():
            return candidate
    return None


def run_cmd(cmd: list[str], timeout: int = 30) -> str:
    try:
        completed = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if completed.returncode == 0:
            return completed.stdout.strip()
    except Exception:
        return ""
    return ""


def sanitize_fragment(text: str, fallback: str = "Betreff") -> str:
    s = text.strip()
    if not s:
        return fallback
    repl = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue"}
    for src, dst in repl.items():
        s = s.replace(src, dst)
    s = re.sub(r"[^A-Za-z0-9]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s[:80] if s else fallback


def should_process(path: Path, force_all: bool) -> bool:
    if path.name.startswith("."):
        return False
    if path.suffix.lower() not in ALLOWED_EXTENSIONS:
        return False
    if force_all:
        return True

    # Bereits sauber benannte Dateien (Datum + max. 3 Worte) nicht erneut anfassen.
    if re.match(r"^\d{2}\.\d{2}\.20\d{2}_[A-Za-z0-9]+(?:_[A-Za-z0-9]+){0,2}(?:_\d+)?$", path.stem):
        return False
    if any(p.search(path.stem) for p in GENERIC_PATTERNS):
        return True
    if re.search(r"_(Dokument|Rechnung|Beleg|Vertrag)(_|$)", path.name):
        return True
    return True


def read_text(path: Path, ocr_pages: int) -> str:
    ext = path.suffix.lower()
    pdftotext_bin = resolve_tool("pdftotext")
    pdftoppm_bin = resolve_tool("pdftoppm")
    tesseract_bin = resolve_tool("tesseract")

    text = ""
    if ext == ".pdf" and pdftotext_bin:
        text = run_cmd([pdftotext_bin, "-f", "1", "-l", str(max(1, ocr_pages)), "-nopgbrk", str(path), "-"])

    if len(text) < 60 and ext == ".pdf" and pdftoppm_bin and tesseract_bin:
        ocr_chunks: list[str] = []
        with tempfile.TemporaryDirectory(prefix="scan_ocr_") as tmp:
            for page in range(1, max(1, ocr_pages) + 1):
                prefix = Path(tmp) / f"page_{page}"
                run_cmd([pdftoppm_bin, "-f", str(page), "-singlefile", "-png", str(path), str(prefix)], timeout=45)
                png = Path(f"{prefix}.png")
                if png.exists():
                    chunk = run_cmd([tesseract_bin, str(png), "stdout", "-l", "deu+eng"], timeout=45)
                    if chunk:
                        ocr_chunks.append(chunk)
        if ocr_chunks:
            text = "\n".join(ocr_chunks)

    if len(text) < 40 and ext in {".png", ".jpg", ".jpeg", ".tif", ".tiff"} and tesseract_bin:
        text = run_cmd([tesseract_bin, str(path), "stdout", "-l", "deu+eng"], timeout=45)

    return text[:30000]


def normalize_year_token(token: str, fallback_year: int) -> Optional[int]:
    t = token.strip()
    if not t:
        return None
    if t.isdigit():
        y = int(t)
        return y if 2000 <= y <= 2099 else None

    # OCR can corrupt single digits, e.g. "202!" instead of "2025".
    if len(t) == 4 and t.startswith("20"):
        fb = str(fallback_year)
        if len(fb) != 4:
            fb = "2000"
        chars: list[str] = []
        for idx, ch in enumerate(t):
            if ch.isdigit():
                chars.append(ch)
            else:
                chars.append(fb[idx])
        if "".join(chars).isdigit():
            y = int("".join(chars))
            return y if 2000 <= y <= 2099 else None
    return None


def parse_dates_in_line(line: str, fallback_year: int) -> list[dt.date]:
    out: list[dt.date] = []

    def add(y: int, m: int, d: int) -> None:
        try:
            out.append(dt.date(y, m, d))
        except ValueError:
            pass

    for y, m, d in re.findall(r"\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b", line):
        add(int(y), int(m), int(d))
    for d, m, y in re.findall(r"\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b", line):
        add(int(y), int(m), int(d))
    for d, mon, ytok in re.findall(r"\b(\d{1,2})\.?\s+([A-Za-zÄÖÜäöü]{3,10})\.?\s+([20][0-9A-Za-z!|IlOSBZ]{3})", line):
        key = mon.strip(".").lower()
        month = MONTHS.get(key)
        year = normalize_year_token(ytok, fallback_year)
        if month and year:
            add(year, month, int(d))

    return out


def parse_document_date(text: str, fallback_mtime: float) -> str:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    fallback = dt.date.fromtimestamp(fallback_mtime)
    fallback_year = fallback.year
    label_re = re.compile(r"(rechnungsdatum|invoice date|datum|date|ausstellungsdatum|belegdatum)", re.IGNORECASE)

    for line in lines[:120]:
        if not label_re.search(line):
            continue
        dates = parse_dates_in_line(line, fallback_year=fallback_year)
        if dates:
            return dates[0].isoformat()

    all_dates: list[dt.date] = []
    for line in lines[:150]:
        all_dates.extend(parse_dates_in_line(line, fallback_year=fallback_year))

    if all_dates:
        best = min(all_dates, key=lambda d: abs((d - fallback).days))
        return best.isoformat()
    return fallback.isoformat()


def parse_date_from_filename(stem: str) -> Optional[str]:
    m = re.search(r"\b(20\d{2})-(\d{2})-(\d{2})\b", stem)
    if not m:
        return None
    try:
        d = dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        return d.isoformat()
    except ValueError:
        return None


def to_german_date(iso_date: str) -> str:
    try:
        parsed = dt.date.fromisoformat(iso_date)
        return parsed.strftime("%d.%m.%Y")
    except ValueError:
        return iso_date


def normalize_subject(raw: str) -> str:
    s = raw.strip()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"^[\-:;,.\s]+", "", s)
    s = re.sub(r"\b(rechnung|invoice|beleg|vertrag)\b[:\s-]*", "", s, flags=re.IGNORECASE)
    s = s.strip()
    words = [w for w in s.split(" ") if w]
    if len(words) > 10:
        s = " ".join(words[:10])
    return sanitize_fragment(s, "Betreff")


def core_subject(raw: str, max_words: int = 2) -> str:
    words = re.findall(r"[A-Za-zÄÖÜäöü0-9]+", raw.replace("_", " "))
    filtered = [w for w in words if w.lower() not in SUBJECT_STOPWORDS and len(w) > 1]
    selected = filtered if filtered else words
    if not selected:
        return "Dokument"
    return sanitize_fragment(" ".join(selected[:max_words]), "Dokument")


def detect_organization(text: str, original_stem: str) -> str:
    def normalize_for_match(s: str) -> str:
        s = s.lower().translate(OCR_CHAR_MAP)
        s = re.sub(r"[^a-z0-9äöüß]+", " ", s)
        return re.sub(r"\s+", " ", s).strip()

    def fuzzy_contains(haystack: str, needle: str) -> bool:
        parts = [re.escape(x) for x in normalize_for_match(needle).split(" ") if x]
        if not parts:
            return False
        pattern = r"\b" + r"\s+".join(parts) + r"\b"
        return re.search(pattern, normalize_for_match(haystack)) is not None

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    recipient_idx = None
    for idx, ln in enumerate(lines[:80]):
        if re.search(r"^(herr|herrn|frau)\b", ln.strip(), flags=re.IGNORECASE):
            recipient_idx = idx
            break

    header_lines = lines[:recipient_idx] if recipient_idx is not None and recipient_idx > 0 else lines[:30]
    header_text = " ".join(header_lines)

    for label, patterns in ORGANIZATION_PATTERNS:
        if any(fuzzy_contains(header_text, p) for p in patterns):
            return label

    best_label = ""
    best_score = -1
    for idx, line in enumerate(header_lines[:35]):
        low = line.lower()
        if any(tok in low for tok in ("telefon", "fax", "e-mail", "iban", "bic", "www", "@")):
            continue
        if re.search(r"\b\d{4,}\b", line) and not re.search(r"\b(ag|eg|gmbh|mbh|ev)\b", low):
            continue
        tokens = re.findall(r"[A-Za-zÄÖÜäöü]+", low)
        token_set = {t.lower() for t in tokens}
        if not any(h in token_set for h in ORGANIZATION_HINTS):
            continue
        cleaned = re.sub(r"[^A-Za-zÄÖÜäöü0-9\s-]", " ", line)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if not cleaned:
            continue
        words = re.findall(r"[A-Za-zÄÖÜäöü0-9]+", cleaned)
        if not words:
            continue
        acronyms = [w for w in words if w.isupper() and 2 <= len(w) <= 8 and w.lower() not in ORG_NOISE_WORDS]
        sig = [w for w in words if w.lower() not in SUBJECT_STOPWORDS and w.lower() not in ORG_NOISE_WORDS]

        score = 0
        score += 3 if acronyms else 0
        score += 2 if any(w.lower() in {"gmbh", "mbh", "ag", "eg", "ev"} for w in sig) else 0
        score += 2 if any(w.lower() in {"versicherung", "agentur", "polizei", "amt", "kasse", "bank"} for w in sig) else 0
        score += min(2, len(sig) // 2)
        score += max(0, 3 - idx // 8)  # Earlier header lines are more likely the sender.
        if score <= best_score or not sig:
            continue

        if acronyms:
            candidate = acronyms[0]
        else:
            candidate = " ".join(sig[:2])

        best_label = sanitize_fragment(candidate, "Absender")
        best_score = score

    # Kein Rückgriff auf den bestehenden Dateinamen:
    # falsche Labels im Namen würden sich sonst selbst perpetuieren.
    return best_label or "Absender"


def compose_title(subject: str, doc_type: str, organization: str, max_words: int = 3) -> str:
    base = core_subject(subject if subject != "Betreff" else doc_type, max_words=2)
    base_words = re.findall(r"[A-Za-z0-9]+", base.replace("_", " "))
    org_words = re.findall(r"[A-Za-z0-9]+", organization.replace("_", " ")) if organization else []
    org_unique: list[str] = []
    for w in org_words:
        if w.lower() not in {x.lower() for x in org_unique}:
            org_unique.append(w)
    reserved_for_org = min(len(org_unique), max_words) if org_unique else 0
    max_base_words = max(1, max_words - reserved_for_org) if reserved_for_org else max_words

    words: list[str] = []
    for w in base_words:
        if len(words) >= max_base_words:
            break
        words.append(w)

    for w in org_unique:
        if len(words) >= max_words:
            break
        if w.lower() not in {x.lower() for x in words}:
            words.append(w)

    if not words:
        words = re.findall(r"[A-Za-z0-9]+", doc_type)[:max_words] or ["Dokument"]
    return sanitize_fragment(" ".join(words[:max_words]), "Dokument")


def detect_invoice_item(lines: list[str]) -> str:
    header_tokens = ("artikel", "bezeichnung", "leistung", "produkt", "position", "beschreibung", "item", "description", "service")
    blocked = ("summe", "gesamt", "total", "mwst", "steuer", "versand", "zahlbar", "ust", "iban", "bic")
    skip_like_qty = re.compile(r"^\s*[\dxX\.\-,]+\s*(x|stk|stuck|stack)?\s*[\dxX\.\-,]*\s*$", re.IGNORECASE)

    for idx, line in enumerate(lines[:180]):
        low = line.lower()
        if not any(token in low for token in header_tokens):
            continue
        scored: list[tuple[int, str]] = []
        for candidate in lines[idx + 1: idx + 14]:
            c = re.sub(r"\s+", " ", candidate).strip()
            c_low = c.lower()
            if len(c) < 6:
                continue
            if any(tok in c_low for tok in blocked):
                continue
            if skip_like_qty.match(c):
                continue
            if re.search(r"\b\d+[.,]\d{2}\s*(eur|€)\b", c_low):
                continue
            # Favor descriptive product/service lines with multiple words.
            words = re.findall(r"[A-Za-zÄÖÜäöü]{2,}", c)
            if len(words) < 2:
                continue
            score = len(words)
            if any(w[0].isupper() for w in words):
                score += 2
            if any(k in c_low for k in ("katheter", "bag", "service", "paket", "abo", "tarif")):
                score += 3
            scored.append((score, c))
        if scored:
            scored.sort(key=lambda x: x[0], reverse=True)
            return normalize_subject(scored[0][1])
    return ""


def extract_subject(text: str, original_stem: str) -> str:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    low_text = text.lower()

    label_pattern = re.compile(r"^(betreff|gegenstand|subject)\s*[:\-]?\s*(.*)$", re.IGNORECASE)
    for idx, line in enumerate(lines[:120]):
        m = label_pattern.search(line)
        if not m:
            continue
        inline_value = m.group(2).strip()
        if inline_value and len(inline_value) > 2:
            return core_subject(normalize_subject(inline_value), max_words=2)
        if idx + 1 < len(lines):
            nxt = lines[idx + 1].strip()
            if nxt and len(nxt) > 2:
                return core_subject(normalize_subject(nxt), max_words=2)

    for pat, label in SUBJECT_MAP:
        if re.search(pat, low_text, flags=re.IGNORECASE):
            return sanitize_fragment(label, "Betreff")

    for term in PRIORITY_TERMS:
        if re.search(rf"\b{re.escape(term)}\b", low_text):
            return normalize_subject(term)

    if "rechnung" in low_text or "invoice" in low_text or "zuzahlungsrechnung" in low_text:
        item = detect_invoice_item(lines)
        if item:
            return item

    stem_tokens = [t for t in re.findall(r"[A-Za-zÄÖÜäöü]{3,}", original_stem) if t.lower() not in FILENAME_NOISE]
    if stem_tokens:
        return core_subject(normalize_subject(stem_tokens[0]), max_words=2)

    return "Betreff"


def detect_document_type(text: str) -> str:
    low_text = text.lower()
    best_label = "Dokument"
    best_score = 0

    for label, patterns in DOCUMENT_TYPE_PATTERNS:
        score = 0
        for p in patterns:
            if p in low_text:
                score += 1
        if score > best_score:
            best_score = score
            best_label = label

    return best_label


def unique_path(target: Path, reserved_paths: Optional[set[str]] = None) -> Path:
    reserved_paths = reserved_paths or set()
    if not target.exists() and str(target) not in reserved_paths:
        return target
    stem, suffix = target.stem, target.suffix
    for i in range(2, 1000):
        c = target.with_name(f"{stem}_{i}{suffix}")
        if not c.exists() and str(c) not in reserved_paths:
            return c
    raise RuntimeError(f"Keine freie Datei fuer {target}")


def process_file(
    path: Path,
    scan_dir: Path,
    dry_run: bool,
    ocr_pages: int,
    reserved_paths: Optional[set[str]] = None,
) -> tuple[bool, str]:
    text = read_text(path, ocr_pages=ocr_pages)
    detected_date = parse_document_date(text, path.stat().st_mtime) or parse_date_from_filename(path.stem) or dt.date.fromtimestamp(path.stat().st_mtime).isoformat()
    date_part = to_german_date(detected_date)
    doc_type = sanitize_fragment(detect_document_type(text), "Dokument")
    subject = extract_subject(text, path.stem)
    organization = detect_organization(text, path.stem)
    title = compose_title(subject, doc_type, organization, max_words=3)
    new_name = f"{date_part}_{title}{path.suffix.lower()}"
    preferred_target = scan_dir / new_name
    if preferred_target.resolve() == path.resolve():
        return False, f"Unveraendert: {path.name}"

    target = unique_path(preferred_target, reserved_paths=reserved_paths)
    if reserved_paths is not None:
        reserved_paths.add(str(target))

    if dry_run:
        return True, f"[DRY-RUN] {path.name} -> {target.name}"

    path.rename(target)
    return True, f"{path.name} -> {target.name}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Benennt Scan-Dateien als Datum_Betreff um (max. 3 Woerter).")
    parser.add_argument("--scan-dir", required=True, help="Pfad zum Scan-Ordner")
    parser.add_argument("--dry-run", action="store_true", help="Nur anzeigen, nichts umbenennen")
    parser.add_argument("--force-all", action="store_true", help="Alle passenden Dateien verarbeiten")
    parser.add_argument("--ocr-pages", type=int, default=2, help="Anzahl Seiten fuer OCR/Textanalyse bei PDFs")
    args = parser.parse_args()

    scan_dir = Path(args.scan_dir).expanduser()
    if not scan_dir.exists() or not scan_dir.is_dir():
        print(f"Scan-Ordner nicht gefunden: {scan_dir}", file=sys.stderr)
        return 2

    files = sorted([p for p in scan_dir.rglob("*") if p.is_file()], key=lambda p: p.stat().st_mtime)

    processed = 0
    reserved_paths: set[str] = set()
    for path in files:
        if not should_process(path, force_all=args.force_all):
            continue
        changed, msg = process_file(
            path,
            scan_dir=scan_dir,
            dry_run=args.dry_run,
            ocr_pages=max(1, args.ocr_pages),
            reserved_paths=reserved_paths,
        )
        print(msg)
        if changed:
            processed += 1

    if processed == 0:
        print("Keine Dateien zur Verarbeitung gefunden.")
    else:
        print(f"Verarbeitet: {processed}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
