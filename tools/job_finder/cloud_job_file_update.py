#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


def strtobool(v: str) -> bool:
    return str(v).strip().lower() in {"1", "true", "yes", "y", "on"}


def should_run_now(target_tz: str, target_hour: int, force_run: bool) -> tuple[bool, datetime]:
    now_local = datetime.now(ZoneInfo(target_tz))
    if force_run:
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


def published_text(job: dict) -> str:
    age = job.get("ageDays")
    if isinstance(age, int) and age >= 0 and age != 9999:
        return f"vor {age} Tagen"
    raw = str(job.get("publishedAt") or "").strip()
    if not raw:
        return "unbekannt"
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date().isoformat()
    except Exception:
        return raw


def reason_text(job: dict) -> str:
    reasons = job.get("reasons") or []
    if isinstance(reasons, list) and reasons:
        return ", ".join(str(r) for r in reasons if str(r).strip())
    return "Profil-Match"


def build_markdown(now_local: datetime, jobs: list[dict], run_summary: str, run_warnings: str) -> str:
    lines = [
        "# Job Update Berlin/Potsdam",
        "",
        f"- Stand: {now_local.strftime('%Y-%m-%d %H:%M %Z')}",
        "",
    ]

    sections = [
        ("StepStone", "StepStone", 15),
        ("GesinesJobtipps", "Gesine", 15),
        ("Interamt", "Interamt", 10),
    ]

    for source_key, label, max_items in sections:
        subset = [j for j in jobs if str(j.get("source") or "").lower() == source_key.lower()][:max_items]
        lines.append(f"## {label} (max. {max_items})")
        lines.append("")
        if not subset:
            lines.append("Keine Treffer.")
            lines.append("")
            continue

        for idx, j in enumerate(subset, 1):
            lines.extend(
                [
                    f"### {idx}. {str(j.get('title') or 'Ohne Titel')}",
                    f"- Ort: {str(j.get('location') or 'unbekannt')}",
                    f"- Arbeitgeber: {str(j.get('company') or 'unbekannt')}",
                    f"- Veröffentlicht: {published_text(j)}",
                    f"- Warum passt es: {reason_text(j)}",
                    f"- Link: {str(j.get('url') or '')}",
                    "",
                ]
            )

    if run_summary:
        lines.append("## Lauf-Summary")
        lines.append("")
        lines.extend(f"- {line}" for line in run_summary.splitlines()[:40])
        lines.append("")
    if run_warnings:
        lines.append("## Warnungen")
        lines.append("")
        lines.extend(f"- {line}" for line in run_warnings.splitlines()[:40])
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--target-tz", default="Europe/Berlin")
    ap.add_argument("--target-hour", type=int, default=8)
    ap.add_argument("--workdir", default=".")
    ap.add_argument("--output-dir", default="jobs")
    args = ap.parse_args()

    force_run = strtobool(os.getenv("FORCE_RUN", "false"))
    should_run, now_local = should_run_now(args.target_tz, args.target_hour, force_run)
    if not should_run:
        print(f"Skip update: current hour in {args.target_tz} is {now_local.hour}, target is {args.target_hour}")
        return 0

    os.chdir(args.workdir)
    tmp_md = Path("/tmp/jobfinder_cloud_jobs.md")
    tmp_json = Path("/tmp/jobfinder_cloud_jobs.json")
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    code, stdout_text, stderr_text = run_finder(args.config, tmp_md, tmp_json)
    jobs = []
    if tmp_json.exists():
        try:
            jobs = json.loads(tmp_json.read_text(encoding="utf-8"))
        except Exception:
            jobs = []

    md = build_markdown(now_local, jobs, stdout_text, stderr_text)
    (out_dir / "latest.md").write_text(md, encoding="utf-8")
    (out_dir / "latest.json").write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "latest.meta.json").write_text(
        json.dumps(
            {
                "generatedAt": now_local.isoformat(),
                "timezone": args.target_tz,
                "finderExitCode": code,
                "count": len(jobs),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"Wrote {out_dir / 'latest.md'} and {out_dir / 'latest.json'} ({len(jobs)} jobs)")
    if code != 0:
        print(f"Finder exited with code {code}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

