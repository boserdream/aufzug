#!/usr/bin/env python3
import argparse
import os
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
        sys.executable,
        "tools/job_finder/job_finder.py",
        "--config",
        config_path,
        "--out",
        str(out_md),
        "--json",
        str(out_json),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def compose_body(now_local: datetime, md_text: str, stdout_text: str, stderr_text: str) -> str:
    lines = [
        "Daily Job Update",
        f"Stand: {now_local.strftime('%Y-%m-%d %H:%M %Z')}",
        "",
    ]
    if stdout_text:
        lines.append("Run-Summary:")
        lines.extend(stdout_text.splitlines()[:30])
        lines.append("")
    if stderr_text:
        lines.append("Warnungen:")
        lines.extend(stderr_text.splitlines()[:30])
        lines.append("")
    if md_text:
        lines.append(md_text)
    else:
        lines.append("Keine Treffer oder keine Ausgabe erzeugt.")
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
    md_text = out_md.read_text(encoding="utf-8") if out_md.exists() else ""
    body = compose_body(now_local, md_text, stdout_text, stderr_text)

    subject = f"Daily Job Update Berlin/Potsdam - {now_local.strftime('%Y-%m-%d %H:%M %Z')}"

    smtp_host = require_any_env("SMTP_HOST", "SMTP_SERVER")
    smtp_port = int(first_env("SMTP_PORT", "SMTP_SERVER_PORT") or "587")
    smtp_user = first_env("SMTP_USERNAME", "SMTP_USER")
    smtp_password = first_env("SMTP_PASSWORD", "SMTP_PASS")
    mail_from = require_any_env("MAIL_FROM", "EMAIL_FROM")
    mail_to = require_any_env("MAIL_TO", "EMAIL_TO")
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
