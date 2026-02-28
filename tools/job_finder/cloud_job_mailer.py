#!/usr/bin/env python3
import argparse
import json
import os
import re
import smtplib
import subprocess
import sys
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo


def strtobool(v: str) -> bool:
    return str(v).strip().lower() in {"1", "true", "yes", "y", "on"}


def should_send_now(target_tz: str, target_hour: int, force_send: bool) -> tuple[bool, datetime]:
    now_local = datetime.now(ZoneInfo(target_tz))
    if force_send:
        return True, now_local
    return now_local.hour == target_hour, now_local


def run_finder(config_path: str, out_md: Path, out_json: Path) -> tuple[int, str, str]:
    cmd = [
        os.getenv("NODE_BIN", "node"),
        "tools/job_finder/job_finder.mjs",
        "--config",
        config_path,
        "--out",
        str(out_md),
        "--json",
        str(out_json),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def published_text(job: dict) -> str:
    age = job.get("ageDays")
    if isinstance(age, int) and age >= 0 and age != 9999:
        return f"vor {age} Tagen"
    raw = str(job.get("publishedAt") or "").strip()
    if not raw:
        return "unbekannt"
    try:
        d = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        delta = (datetime.now(d.tzinfo) - d).days
        if delta >= 0:
            return f"vor {delta} Tagen"
    except Exception:
        pass
    return "unbekannt"


def reason_text(job: dict) -> str:
    reasons = job.get("reasons") or []
    if isinstance(reasons, list) and reasons:
        clean = [str(r).strip() for r in reasons if str(r).strip()]
        if clean:
            return f"Ausgewählt wegen Profil-Match: {', '.join(clean)}."
    return "Ausgewählt, weil die Aufgaben gut zu deinem Profil passen."


def normalize_location(value) -> str:
    def _clean(s: str) -> str:
        return re.sub(r"\s+", " ", str(s or "").strip())

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
            parts = [_clean(p) for p in parts if _clean(p)]
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
            return normalize_location(json.loads(s))
        except Exception:
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
            return "unbekannt"
    return s


def compose_body(now_local: datetime, jobs: list[dict], stdout_text: str, stderr_text: str) -> str:
    lines = [
        "📬 Daily Job Update Berlin/Potsdam",
        f"🕒 Stand: {now_local.strftime('%d.%m.%Y %H:%M %Z')}",
        "",
    ]

    sections = [
        ("StepStone", "🟦", "StepStone", 10),
        ("StudySmarter", "🟧", "StudySmarter", 10),
        ("GesinesJobtipps", "🟩", "Gesine", 10),
        ("Interamt", "🟨", "Interamt", 5),
        ("KarriereportalBerlin", "🟧", "Karriereportal Berlin", 5),
        ("Arbeitsagentur", "🟧", "Arbeitsagentur", 5),
        ("GoodJobs", "🟧", "GoodJobs", 5),
    ]

    for source_key, emoji, label, max_items in sections:
        lines.append(f"{emoji} {label} (max. {max_items})")
        lines.append("=" * len(lines[-1]))
        subset = [j for j in jobs if str(j.get("source") or "").lower() == source_key.lower()][:max_items]
        if not subset:
            lines.append("Keine Treffer.")
            lines.append("")
            continue
        for idx, j in enumerate(subset, 1):
            location = normalize_location(j.get("location")) or "unbekannt"
            lines.extend(
                [
                    f"{idx}. {str(j.get('title') or 'Ohne Titel')}",
                    f"   📍 Ort: {location}",
                    f"   🏢 Arbeitgeber: {str(j.get('company') or 'unbekannt')}",
                    f"   🗓️ Veröffentlicht: {published_text(j)}",
                    "   ⏳ Bewerbungsfrist: unbekannt",
                    f"   ✅ Warum passt es: {reason_text(j)}",
                    f"   🔗 Link: {str(j.get('url') or '')}",
                    "",
                    "   ------------------------------------------------------------",
                    "",
                ]
            )

    if stderr_text:
        lines.append("⚠️ Warnungen:")
        lines.extend(stderr_text.splitlines()[:20])
        lines.append("")
    if stdout_text:
        lines.append("📄 Run-Summary:")
        lines.extend(stdout_text.splitlines()[:20])
        lines.append("")

    return "\n".join(lines)


def send_mail(subject: str, body: str, smtp_host: str, smtp_port: int, smtp_user: str, smtp_password: str,
              mail_from: str, mail_to: str, use_starttls: bool = True) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = mail_from
    msg["To"] = mail_to
    msg.set_content(body)

    with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as smtp:
        smtp.ehlo()
        if use_starttls:
            smtp.starttls()
            smtp.ehlo()
        if smtp_user:
            smtp.login(smtp_user, smtp_password)
        smtp.send_message(msg)


def first_env(*names: str) -> str:
    for name in names:
        val = os.getenv(name, "").strip()
        if val:
            return val
    return ""


def require_any_env(*names: str) -> str:
    val = first_env(*names)
    if not val:
        raise RuntimeError(f"Missing required env var (one of): {', '.join(names)}")
    return val


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--target-tz", default="Europe/Berlin")
    ap.add_argument("--target-hour", type=int, default=8)
    ap.add_argument("--workdir", default=".")
    args = ap.parse_args()

    force_send = strtobool(os.getenv("FORCE_SEND", "false"))
    should_send, now_local = should_send_now(args.target_tz, args.target_hour, force_send)
    if not should_send:
        print(f"Skip send: current hour in {args.target_tz} is {now_local.hour}, target is {args.target_hour}")
        return 0

    os.chdir(args.workdir)
    out_md = Path("/tmp/jobfinder_cloud_jobs.md")
    out_json = Path("/tmp/jobfinder_cloud_jobs.json")

    code, stdout_text, stderr_text = run_finder(args.config, out_md, out_json)
    jobs = []
    if out_json.exists():
        try:
            jobs = json.loads(out_json.read_text(encoding="utf-8"))
        except Exception:
            jobs = []
    body = compose_body(now_local, jobs, stdout_text, stderr_text)

    subject = f"Daily Job Update Berlin/Potsdam - {now_local.strftime('%Y-%m-%d %H:%M %Z')}"

    smtp_host = require_any_env("SMTP_HOST", "SMTP_SERVER")
    smtp_port = int(first_env("SMTP_PORT", "SMTP_SERVER_PORT") or "587")
    smtp_user = first_env("SMTP_USERNAME", "SMTP_USER")
    smtp_password = first_env("SMTP_PASSWORD", "SMTP_PASS")
    mail_from = first_env("MAIL_FROM", "EMAIL_FROM", "SMTP_USERNAME", "SMTP_USER")
    if not mail_from:
        raise RuntimeError("Missing required env var (one of): MAIL_FROM, EMAIL_FROM, SMTP_USERNAME, SMTP_USER")
    mail_to = first_env("MAIL_TO", "EMAIL_TO", mail_from)
    use_starttls = strtobool(os.getenv("SMTP_USE_STARTTLS", "true"))

    send_mail(
        subject=subject,
        body=body,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        mail_from=mail_from,
        mail_to=mail_to,
        use_starttls=use_starttls,
    )

    print("Mail sent")
    if code != 0:
        print(f"Finder exited with code {code}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
