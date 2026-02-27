#!/usr/bin/env python3
"""Monitor selected Berlin elevators from brokenlifts.org and notify on status changes."""

from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

BROKEN_MARKER = "Außer Betrieb"
WORKING_MARKER = "Der Aufzug steht zur Verfügung."
UNKNOWN_MARKER = "Aktuell liegen keine Informationen vor."


@dataclass
class LiftStatus:
    key: str
    name: str
    url: str
    status: str
    details: str
    checked_at: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Monitor elevator status changes from brokenlifts.org")
    parser.add_argument(
        "--config",
        default="tools/lift_monitor/config.example.json",
        help="Path to config JSON with lifts",
    )
    parser.add_argument(
        "--state",
        default="tools/lift_monitor/state.json",
        help="Path to persistent status state JSON",
    )
    parser.add_argument(
        "--loop",
        action="store_true",
        help="Run continuously (otherwise run once)",
    )
    parser.add_argument(
        "--interval-seconds",
        type=int,
        help="Override polling interval in config",
    )
    parser.add_argument(
        "--notify",
        choices=["osascript", "stdout", "none"],
        default="osascript",
        help="Notification backend",
    )
    return parser.parse_args()


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "lift"


def fetch_page(url: str, timeout_seconds: int = 15) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "BerlinLiftMonitor/1.0 (+local-script)",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
        raw = response.read().decode("utf-8", errors="replace")
    return raw


def html_to_text(raw_html: str) -> str:
    no_script = re.sub(r"<script\b[^>]*>.*?</script>", " ", raw_html, flags=re.IGNORECASE | re.DOTALL)
    no_style = re.sub(r"<style\b[^>]*>.*?</style>", " ", no_script, flags=re.IGNORECASE | re.DOTALL)
    without_tags = re.sub(r"<[^>]+>", " ", no_style)
    text = html.unescape(without_tags)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def parse_status_from_text(text: str) -> tuple[str, str]:
    broken_idx = text.find(BROKEN_MARKER)
    working_idx = text.find(WORKING_MARKER)
    unknown_idx = text.find(UNKNOWN_MARKER)

    candidates = []
    if broken_idx != -1:
        candidates.append((broken_idx, "broken"))
    if working_idx != -1:
        candidates.append((working_idx, "working"))
    if unknown_idx != -1:
        candidates.append((unknown_idx, "unknown"))

    if not candidates:
        return "unknown", "Kein eindeutiger Status-Text gefunden."

    candidates.sort(key=lambda x: x[0])
    status = candidates[0][1]

    if status == "broken":
        match = re.search(r"Außer Betrieb(?:\s*\([^)]*\))?", text)
        details = match.group(0) if match else BROKEN_MARKER
    elif status == "working":
        details = WORKING_MARKER
    else:
        details = UNKNOWN_MARKER

    return status, details


def evaluate_lift(name: str, url: str) -> LiftStatus:
    raw_html = fetch_page(url)
    text = html_to_text(raw_html)
    status, details = parse_status_from_text(text)
    now_iso = datetime.now().isoformat(timespec="seconds")
    key = slugify(name)
    return LiftStatus(key=key, name=name, url=url, status=status, details=details, checked_at=now_iso)


def notify(title: str, message: str, backend: str) -> None:
    if backend == "none":
        return

    if backend == "stdout":
        print(f"[NOTIFY] {title}: {message}")
        return

    safe_title = title.replace('"', "'")
    safe_message = message.replace('"', "'")
    cmd = [
        "osascript",
        "-e",
        f'display notification "{safe_message}" with title "{safe_title}"',
    ]
    try:
        subprocess.run(cmd, check=False, capture_output=True)
    except OSError:
        print(f"[WARN] osascript not available. {title}: {message}")


def status_to_message(item: LiftStatus) -> tuple[str, str]:
    if item.status == "broken":
        return (
            f"Aufzug kaputt: {item.name}",
            f"{item.details} | {item.url}",
        )
    if item.status == "working":
        return (
            f"Aufzug wieder ok: {item.name}",
            f"{item.details} | {item.url}",
        )
    return (
        f"Aufzug-Status unklar: {item.name}",
        f"{item.details} | {item.url}",
    )


def run_once(config: dict[str, Any], state_path: Path, notify_backend: str) -> int:
    state = load_json(state_path, default={"lifts": {}})
    known = state.get("lifts", {})
    lifts = config.get("lifts", [])
    notify_on_first_run = bool(config.get("notify_on_first_run", False))

    errors = 0
    for lift in lifts:
        name = lift.get("name", "Unbenannter Aufzug")
        url = lift.get("url")
        if not url:
            print(f"[WARN] Eintrag ohne URL übersprungen: {name}")
            continue

        key = lift.get("id") or slugify(name)

        try:
            current = evaluate_lift(name=name, url=url)
        except urllib.error.URLError as err:
            errors += 1
            print(f"[ERROR] Netzwerkfehler bei {name}: {err}")
            continue
        except Exception as err:
            errors += 1
            print(f"[ERROR] Unerwarteter Fehler bei {name}: {err}")
            continue

        previous = known.get(key)
        changed = previous is None or previous.get("status") != current.status

        print(f"[{current.checked_at}] {name}: {current.status} ({current.details})")

        if changed and (notify_on_first_run or previous is not None):
            title, message = status_to_message(current)
            notify(title, message, notify_backend)

        known[key] = {
            "name": current.name,
            "url": current.url,
            "status": current.status,
            "details": current.details,
            "checked_at": current.checked_at,
        }

    state["lifts"] = known
    save_json(state_path, state)
    return 1 if errors else 0


def main() -> int:
    args = parse_args()
    config_path = Path(args.config)
    state_path = Path(args.state)

    config = load_json(config_path, default={})
    if not config.get("lifts"):
        print(f"[ERROR] Keine Aufzüge in {config_path} konfiguriert.")
        return 2

    interval = args.interval_seconds or int(config.get("poll_interval_seconds", 300))

    if not args.loop:
        return run_once(config=config, state_path=state_path, notify_backend=args.notify)

    while True:
        run_once(config=config, state_path=state_path, notify_backend=args.notify)
        time.sleep(max(30, interval))


if __name__ == "__main__":
    sys.exit(main())
