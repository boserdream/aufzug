#!/bin/zsh
set -euo pipefail
set +x
unsetopt XTRACE VERBOSE BG_NICE 2>/dev/null || true

PROJECT_DIR='/Users/moritz/Documents/New project'
PROFILE="$PROJECT_DIR/tools/job_finder/job_profile.moritzfrisch.json"
FINDER="$PROJECT_DIR/tools/job_finder/job_finder.mjs"
FINDER_PY="$PROJECT_DIR/tools/job_finder/job_finder.py"
OUT_JSON='/tmp/jobfinder_daily_jobs.json'
OUT_MD='/tmp/jobfinder_daily_jobs.md'
MAIL_BODY='/tmp/jobfinder_daily_mail.txt'
NOTE_HTML='/tmp/jobfinder_daily_note_body.html'
JOBS_DIR="$PROJECT_DIR/jobs"
LATEST_JSON="$JOBS_DIR/latest.json"
LATEST_MD="$JOBS_DIR/latest.md"
PREV_JSON="$JOBS_DIR/previous.json"
RECIPIENT='moritzfrisch@gmx.net'
NOTES_ENABLED='0'

DATE_HUMAN="$(date '+%d.%m.%Y %H:%M %Z')"
SUBJECT="Daily Job Update Berlin/Potsdam - ${DATE_HUMAN}"
: > "$MAIL_BODY"

render_progress() {
  local _percent="$1"
  local label="$2"
  local eta="$3"
  printf "\r%s | Rest: %ss" "$label" "$eta"
}

progress_wait() {
  local pid="$1"
  local start_pct="$2"
  local end_pct="$3"
  local label="$4"
  local estimate_sec="$5"
  local phase_start
  phase_start="$(date +%s)"
  while kill -0 "$pid" 2>/dev/null; do
    local now elapsed progress_done pct eta
    now="$(date +%s)"
    elapsed=$(( now - phase_start ))
    if [ "$estimate_sec" -le 0 ]; then
      progress_done=0
    else
      progress_done=$(( elapsed * 100 / estimate_sec ))
      if [ "$progress_done" -gt 95 ]; then progress_done=95; fi
    fi
    pct=$(( start_pct + (end_pct - start_pct) * progress_done / 100 ))
    eta=$(( estimate_sec - elapsed ))
    if [ "$eta" -lt 1 ]; then eta=1; fi
    render_progress "$pct" "$label" "$eta"
    sleep 1
  done
  render_progress "$end_pct" "$label" "0"
  printf "\n"
}

echo "== Job-Update: gestartet ${DATE_HUMAN} =="
render_progress 2 "Initialisiere Lauf" "3"
printf "\n"
mkdir -p "$JOBS_DIR"
if [ -f "$LATEST_JSON" ]; then
  cp "$LATEST_JSON" "$PREV_JSON" 2>/dev/null || true
fi

NODE_BIN=""
for candidate in \
  "$(command -v node 2>/dev/null || true)" \
  "/opt/homebrew/bin/node" \
  "/usr/local/bin/node" \
  "/opt/local/bin/node"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [ -n "$NODE_BIN" ]; then
  (
    "$NODE_BIN" "$FINDER" \
      --config "$PROFILE" \
      --out "$OUT_MD" \
      --json "$OUT_JSON" \
      > /tmp/jobfinder_daily_run.log 2>&1 || true
  ) &
  finder_pid=$!
  progress_wait "$finder_pid" 5 55 "Suche Stellenquellen" 120
  wait "$finder_pid" || true
elif command -v python3 >/dev/null 2>&1; then
  (
    /usr/bin/python3 "$FINDER_PY" \
      --config "$PROFILE" \
      --out "$OUT_MD" \
      --json "$OUT_JSON" \
      > /tmp/jobfinder_daily_run.log 2>&1 || true
  ) &
  finder_pid=$!
  progress_wait "$finder_pid" 5 55 "Suche Stellenquellen" 120
  wait "$finder_pid" || true
else
  cat > "$MAIL_BODY" <<EOT
Daily Job Update Berlin/Potsdam

Fehler: weder node noch python3 gefunden.
Zeit: ${DATE_HUMAN}
EOT
fi

if [ -f "$OUT_JSON" ]; then
  if [ -f "$PREV_JSON" ]; then
    /usr/bin/python3 - "$OUT_JSON" "$PREV_JSON" <<'PY'
import json
import sys
from pathlib import Path

cur_path = Path(sys.argv[1])
prev_path = Path(sys.argv[2])
try:
    cur = json.loads(cur_path.read_text(encoding="utf-8"))
except Exception:
    cur = []
try:
    prev = json.loads(prev_path.read_text(encoding="utf-8"))
except Exception:
    prev = []

cur_step = [j for j in cur if str(j.get("source") or "").lower() == "stepstone"]
if not cur_step:
    seen = {str(j.get("url") or "").strip() for j in cur}
    add = []
    for j in prev:
        if str(j.get("source") or "").lower() != "stepstone":
            continue
        u = str(j.get("url") or "").strip()
        if not u or u in seen:
            continue
        add.append(j)
        seen.add(u)
        if len(add) >= 10:
            break
    if add:
        cur = add + cur
        cur_path.write_text(json.dumps(cur, ensure_ascii=False, indent=2), encoding="utf-8")
PY
  fi
  cp "$OUT_JSON" "$LATEST_JSON" 2>/dev/null || true
fi
if [ -f "$OUT_MD" ]; then
  cp "$OUT_MD" "$LATEST_MD" 2>/dev/null || true
fi

if [ ! -s "$MAIL_BODY" ]; then
  (
  /usr/bin/python3 - "$OUT_JSON" "$MAIL_BODY" "$DATE_HUMAN" "$PREV_JSON" <<'PY'
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

json_path = Path(sys.argv[1])
mail_path = Path(sys.argv[2])
date_human = sys.argv[3]
prev_json_path = Path(sys.argv[4]) if len(sys.argv) > 4 else None

lines = [
    "📬 Daily Job Update Berlin/Potsdam",
    f"🕒 Stand: {date_human}",
    "",
]

jobs = []
if json_path.exists():
    try:
        jobs = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception:
        jobs = []

prev_jobs = []
if prev_json_path and prev_json_path.exists():
    try:
        prev_jobs = json.loads(prev_json_path.read_text(encoding="utf-8"))
    except Exception:
        prev_jobs = []

if not jobs:
    lines.append("⚠️ Keine Treffer oder Lauf fehlgeschlagen.")
else:
    detail_cache = {}

    def canonical_url(url: str) -> str:
        raw = str(url or "").strip()
        if not raw:
            return ""
        try:
            p = urlparse(raw)
            drop = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"}
            q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if k.lower() not in drop]
            q.sort()
            return urlunparse((p.scheme.lower(), p.netloc.lower(), p.path.rstrip("/"), "", urlencode(q), ""))
        except Exception:
            return raw.lower()

    prev_url_set = {canonical_url(j.get("url")) for j in (prev_jobs or []) if canonical_url(j.get("url"))}

    def fetch_detail_text(url: str) -> str:
        u = str(url or "").strip()
        if not u.startswith("http"):
            return ""
        if u in detail_cache:
            return detail_cache[u]
        try:
            req = Request(
                u,
                headers={
                    "User-Agent": "job-mailer/1.0",
                    "Accept": "text/html,application/xhtml+xml",
                },
            )
            with urlopen(req, timeout=18) as r:
                html = r.read().decode("utf-8", errors="replace")
            # Very lightweight HTML cleanup for sentence extraction.
            text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
            text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
            text = re.sub(r"<[^>]+>", " ", text)
            text = re.sub(r"\s+", " ", text).strip()
            detail_cache[u] = text
            return text
        except Exception:
            detail_cache[u] = ""
            return ""

    def fmt_date(value: str) -> str:
        v = str(value or "").strip()
        if not v:
            return ""
        for cand in [v.replace("Z", "+00:00"), v]:
            try:
                return datetime.fromisoformat(cand).date().isoformat()
            except Exception:
                pass
        m = re.search(r"(\d{4}-\d{2}-\d{2})", v)
        return m.group(1) if m else v

    def normalize_location(value) -> str:
        def _clean(s: str) -> str:
            t = str(s or "").strip()
            t = re.sub(r"\s+", " ", t)
            return t

        if isinstance(value, dict):
            addr = value.get("address") or value
            if isinstance(addr, dict):
                parts = [
                    addr.get("streetAddress"),
                    addr.get("postalCode"),
                    addr.get("addressLocality"),
                    addr.get("addressRegion"),
                    addr.get("addressCountry"),
                ]
                parts = [_clean(x) for x in parts if _clean(x)]
                # keep order, remove duplicates
                seen = set()
                out = []
                for p in parts:
                    k = p.lower()
                    if k in seen:
                        continue
                    seen.add(k)
                    out.append(p)
                return ", ".join(out)
            return _clean(str(value))

        if isinstance(value, list):
            parts = [normalize_location(v) for v in value]
            parts = [p for p in parts if p]
            return ", ".join(parts)

        s = _clean(str(value or ""))
        if not s:
            return ""

        if s.startswith("{") and s.endswith("}"):
            try:
                obj = json.loads(s)
                return normalize_location(obj)
            except Exception:
                # try extracting common location fields from JSON-like strings
                fields = []
                for pat in [
                    r'"streetAddress"\s*:\s*"([^"]+)"',
                    r'"postalCode"\s*:\s*"([^"]+)"',
                    r'"addressLocality"\s*:\s*"([^"]+)"',
                    r'"addressRegion"\s*:\s*"([^"]+)"',
                    r'"addressCountry"\s*:\s*"([^"]+)"',
                ]:
                    m = re.search(pat, s)
                    if m:
                        fields.append(_clean(m.group(1)))
                if fields:
                    seen = set()
                    out = []
                    for f in fields:
                        k = f.lower()
                        if k in seen:
                            continue
                        seen.add(k)
                        out.append(f)
                    return ", ".join(out)

        # Remove remaining technical artifacts if parsing failed.
        if s.startswith("{") and s.endswith("}"):
            return "unbekannt"
        return s

    def published_how_long(j) -> str:
        age = j.get("ageDays")
        if isinstance(age, int) and age >= 0 and age != 9999:
            return f"vor {age} Tagen"
        raw = str(j.get("publishedAt") or "").strip()
        if not raw:
            return "unbekannt"
        for cand in [raw.replace("Z", "+00:00"), raw]:
            try:
                d = datetime.fromisoformat(cand)
                delta = (datetime.now(d.tzinfo) - d).days
                if delta >= 0:
                    return f"vor {delta} Tagen"
            except Exception:
                pass
        return "unbekannt"

    def extract_deadline(j) -> str:
        text = " ".join([
            str(j.get("description") or ""),
            str(j.get("title") or ""),
        ])
        if len(text) < 120 or "bewerb" not in text.lower():
            text = f"{text} {fetch_detail_text(j.get('url'))}"
        patterns = [
            r"(?i)bewerbungsfrist[:\s]*([0-3]?\d[./][01]?\d[./]\d{2,4})",
            r"(?i)bewerbung(?:en)?\s+bis\s+([0-3]?\d[./][01]?\d[./]\d{2,4})",
            r"(?i)bewerbungsschluss[:\s]*([0-3]?\d[./][01]?\d[./]\d{2,4})",
            r"(?i)bewerbungsende[:\s]*([0-3]?\d[./][01]?\d[./]\d{2,4})",
            r"(?i)frist[:\s]*([0-3]?\d[./][01]?\d[./]\d{2,4})",
            r"(?i)deadline[:\s]*([0-3]?\d[./][01]?\d[./]\d{2,4})",
            r"(?i)bis\s+zum\s+([0-3]?\d[./][01]?\d[./]\d{2,4})",
            r"(?i)bewerbungsfrist[:\s]*(\d{4}-\d{2}-\d{2})",
            r"(?i)bewerbung(?:en)?\s+bis\s+(\d{4}-\d{2}-\d{2})",
            r"(?i)(?:bewerbungsfrist|bewerbungsschluss|bewerbungsende|bewerbungen bis|bis zum)\s*([0-3]?\d\.\s*(?:januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*\d{4})",
        ]
        for p in patterns:
            m = re.search(p, text)
            if m:
                return fmt_date(m.group(1))
        return "unbekannt"

    def extract_relevant_sentence(j) -> str:
        text = " ".join([
            str(j.get("description") or ""),
            fetch_detail_text(j.get("url")),
        ]).strip()
        if not text:
            return ""
        # Split into rough sentences.
        sentences = re.split(r"(?<=[\.\!\?])\s+", text)
        preferred = [
            r"aufgaben",
            r"verantwort",
            r"monitoring",
            r"politik|public affairs|government relations",
            r"kommunikation|presse|öffentlichkeitsarbeit",
            r"projekt",
            r"stakeholder|netzwerk",
            r"analyse|recherche",
            r"vergabe|beschaffung",
        ]
        best = ""
        best_score = -1
        for s in sentences:
            s_clean = re.sub(r"\s+", " ", s).strip()
            if len(s_clean) < 60:
                continue
            if len(s_clean) > 260:
                s_clean = s_clean[:257].rstrip() + "..."
            score = 0
            low = s_clean.lower()
            for pat in preferred:
                if re.search(pat, low):
                    score += 2
            if re.search(r"wir suchen|dein profil|anforderung|must have", low):
                score -= 1
            if score > best_score:
                best = s_clean
                best_score = score
        return best

    def match_reason_sentence(j) -> str:
        ad_sentence = extract_relevant_sentence(j)
        if ad_sentence:
            return f'Ausgewählt, weil die Anzeige z. B. sagt: "{ad_sentence}"'
        reasons = j.get("reasons") or []
        reasons_text = ", ".join([str(r) for r in reasons if str(r).strip()])
        if reasons_text:
            return f"Ausgewählt wegen Profil-Match: {reasons_text}."
        return "Ausgewählt, weil die Aufgaben gut zu deinem Profil in Politik/Public Affairs/Kommunikation passen."

    def rendered_item_text(j, idx):
        title = str(j.get("title") or "Ohne Titel")
        employer = str(j.get("company") or "unbekannt")
        location = normalize_location(j.get("location")) or "unbekannt"
        published = published_how_long(j)
        deadline = extract_deadline(j)
        reason_sentence = match_reason_sentence(j)
        url = str(j.get("url") or "")
        return [
            f"{idx}. {title}",
            f"   📍 Ort: {location}",
            f"   🏢 Arbeitgeber: {employer}",
            f"   🗓️ Veröffentlicht: {published}",
            f"   ⏳ Bewerbungsfrist: {deadline}",
            f"   ✅ Warum passt es: {reason_sentence}",
            f"   🔗 Link: {url}",
            "",
            "   ------------------------------------------------------------",
            "",
        ]

    def dedupe_jobs(section_jobs):
        by_key = {}
        for j in section_jobs:
            k = canonical_url(j.get("url")) or str(j.get("title") or "").strip().lower()
            if not k:
                continue
            cur = by_key.get(k)
            if cur is None:
                by_key[k] = j
                continue
            # Prefer entry with real age value, then higher score.
            cur_age = cur.get("ageDays") if isinstance(cur.get("ageDays"), int) else 9999
            new_age = j.get("ageDays") if isinstance(j.get("ageDays"), int) else 9999
            cur_score = float(cur.get("score") or 0)
            new_score = float(j.get("score") or 0)
            if (new_age < cur_age) or (new_age == cur_age and new_score > cur_score):
                by_key[k] = j
        return list(by_key.values())

    def sort_new_first(section_jobs):
        def key(j):
            cu = canonical_url(j.get("url"))
            is_new = 0 if (cu and cu not in prev_url_set) else 1
            age = j.get("ageDays") if isinstance(j.get("ageDays"), int) else 9999
            has_known_age = 0 if (age != 9999) else 1
            score = float(j.get("score") or 0)
            return (is_new, has_known_age, age, -score)
        return sorted(section_jobs, key=key)

    sections = [
        ("StepStone", "StepStone", 10),
        ("StudySmarter", "StudySmarter", 10),
        ("GesinesJobtipps", "Gesine", 10),
        ("Interamt", "Interamt", 5),
        ("KarriereportalBerlin", "Karriereportal Berlin", 5),
        ("Arbeitsagentur", "Arbeitsagentur", 5),
        ("GoodJobs", "GoodJobs", 5),
    ]

    for source_key, source_label, max_items in sections:
        section_jobs = [j for j in jobs if str(j.get("source") or "").lower() == source_key.lower()]
        section_jobs = dedupe_jobs(section_jobs)
        section_jobs = sort_new_first(section_jobs)
        section_jobs = section_jobs[:max_items]
        source_emoji = "🟦"
        if source_key.lower() == "gesinesjobtipps":
            source_emoji = "🟩"
        elif source_key.lower() == "interamt":
            source_emoji = "🟨"
        elif source_key.lower() in {"studysmarter", "karriereportalberlin", "arbeitsagentur", "linkedinjobs", "goodjobs"}:
            source_emoji = "🟧"
        lines.append(f"{source_emoji} {source_label} (max. {max_items})")
        lines.append("=" * len(lines[-1]))
        if not section_jobs:
            lines.append("Keine Treffer.")
            lines.append("")
            continue
        for idx, j in enumerate(section_jobs, 1):
            lines.extend(rendered_item_text(j, idx))

lines.append("📄 Run-Log: /tmp/jobfinder_daily_run.log")
mail_path.write_text("\n".join(lines), encoding="utf-8")
PY
  ) &
  compose_pid=$!
  progress_wait "$compose_pid" 55 90 "Bereite Mail-Inhalt auf" 100
  wait "$compose_pid"
fi

(
/usr/bin/osascript <<OSA
tell application "Mail"
  set bodyText to (do shell script "/bin/cat " & quoted form of "$MAIL_BODY")
  set m to make new outgoing message with properties {subject:"$SUBJECT", visible:false, content:bodyText}
  tell m
    make new to recipient at end of to recipients with properties {address:"$RECIPIENT"}
    send
  end tell
end tell
OSA
) &
send_pid=$!
progress_wait "$send_pid" 90 100 "Versende Mail" 25
wait "$send_pid"
echo "== Job-Update: abgeschlossen $(date '+%d.%m.%Y %H:%M:%S') =="

if [ "$NOTES_ENABLED" = "1" ]; then
  NOTE_TITLE="Jobliste Berlin/Potsdam - ${DATE_HUMAN}"
  /usr/bin/python3 - "$MAIL_BODY" "$NOTE_HTML" <<'PY'
import html
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
text = src.read_text(encoding="utf-8", errors="replace")
dst.write_text(f"<pre>{html.escape(text)}</pre>", encoding="utf-8")
PY
  /usr/bin/osascript <<OSA || true
tell application "Notes"
  set noteBody to (read POSIX file "$NOTE_HTML" as «class utf8»)
  set noteTitle to "$NOTE_TITLE"
  set targetAccount to default account
  tell targetAccount
    set targetFolder to default folder
    tell targetFolder
      make new note with properties {name:noteTitle, body:noteBody}
    end tell
  end tell
end tell
OSA
fi
