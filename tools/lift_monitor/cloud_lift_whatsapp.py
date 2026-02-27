#!/usr/bin/env python3
"""Cloud lift monitor: check brokenlifts station status and send WhatsApp on changes."""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BROKEN_MARKER = "Au\u00dfer Betrieb"
WORKING_MARKER = "Der Aufzug steht zur Verf\u00fcgung."
UNKNOWN_MARKER = "Aktuell liegen keine Informationen vor."
REPAIR_MARKER = "wird so schnell wie m\u00f6glich repariert"
SOON_MARKER = "f\u00e4hrt in K\u00fcrze wieder"
FORECAST_MARKER = "f\u00e4hrt voraussichtlich ab"


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, help="JSON config with lifts")
    ap.add_argument("--state-file", required=True, help="Path to persisted state JSON")
    ap.add_argument("--dry-run", action="store_true", help="Do not call WhatsApp API")
    ap.add_argument("--test-message", default="", help="Send a WhatsApp test message")
    ap.add_argument("--test-only", action="store_true", help="Only send test message and exit")
    return ap.parse_args()


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_station_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    match = re.match(r"^/station/(\d+)", parsed.path)
    if not match:
        return url
    new_path = f"/station/{match.group(1)}"
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, new_path, "", "", ""))


def fetch_text(url: str, timeout_seconds: int = 20) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "LiftMonitorCloud/1.0",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
        return response.read().decode("utf-8", errors="replace")


def strip_html_tags(value: str) -> str:
    no_tags = re.sub(r"<[^>]+>", " ", value)
    return html.unescape(re.sub(r"\s+", " ", no_tags)).strip()


def map_status_phrase_to_status(phrase: str) -> str:
    if (
        BROKEN_MARKER in phrase
        or REPAIR_MARKER in phrase
        or SOON_MARKER in phrase
        or FORECAST_MARKER in phrase
    ):
        return "broken"
    if WORKING_MARKER in phrase:
        return "working"
    if UNKNOWN_MARKER in phrase:
        return "unknown"
    return "unknown"


def parse_station_slides(raw_html: str, station_url: str) -> list[dict[str, Any]]:
    slide_regex = re.compile(
        r'<li\b([^>]*)>\s*<section class="slider-head">[\s\S]*?<section class="anlagen-description">([\s\S]*?)</section>[\s\S]*?<section class="anlagen-history">',
        re.MULTILINE,
    )
    items: list[dict[str, Any]] = []
    for match in slide_regex.finditer(raw_html):
        attrs = match.group(1) or ""
        description_html = match.group(2) or ""
        class_match = re.search(r'class="([^"]*)"', attrs, re.IGNORECASE)
        class_name = (class_match.group(1) if class_match else "").lower()

        info_match = re.search(
            r'<p\s+class="(?:broken-info|unbroken-info)">([\s\S]*?)</p>',
            description_html,
            re.IGNORECASE,
        )
        direction_match = re.search(
            r"<p>\s*(Aufzug zwischen[\s\S]*?)</p>",
            description_html,
            re.IGNORECASE,
        )
        info_text = strip_html_tags(info_match.group(1) if info_match else "")
        direction_text = strip_html_tags(direction_match.group(1) if direction_match else "")
        status_from_info = map_status_phrase_to_status(info_text)
        if "broken" in class_name:
            status = "broken"
        elif "unbroken" in class_name and status_from_info == "unknown":
            status = "working"
        else:
            status = status_from_info

        details = f"{info_text} ({direction_text})" if direction_text else (info_text or "Unbekannter Status")
        items.append(
            {
                "index": len(items) + 1,
                "status": status,
                "details": details,
                "url": station_url,
            }
        )
    return items


def aggregate_station(sub_lifts: list[dict[str, Any]]) -> tuple[str, str]:
    if not sub_lifts:
        return "unknown", "Kein eindeutiger Status gefunden."
    broken = sum(1 for x in sub_lifts if x["status"] == "broken")
    working = sum(1 for x in sub_lifts if x["status"] == "working")
    total = len(sub_lifts)
    if broken > 0:
        return "broken", f"{broken} von {total} Aufzügen defekt"
    if working == total:
        return "working", f"Alle {total} Aufzüge verfügbar"
    return "unknown", "Status unklar"


def status_symbol(status: str) -> str:
    if status == "working":
        return "✓"
    if status == "broken":
        return "✕"
    if status == "unknown":
        return "?"
    return "!"


def binary_status(status: str) -> bool:
    return status in {"working", "broken"}


def collect_sub_lift_changes(prev: list[dict[str, Any]], nxt: list[dict[str, Any]]) -> list[str]:
    prev_map = {int(x.get("index", 0)): x.get("status") for x in prev}
    changes: list[str] = []
    for item in nxt:
        idx = int(item.get("index", 0))
        prev_status = prev_map.get(idx)
        new_status = item.get("status")
        if binary_status(prev_status) and binary_status(new_status) and prev_status != new_status:
            changes.append(f"Aufzug {idx}: {status_symbol(prev_status)} -> {status_symbol(new_status)}")
    return changes


def send_whatsapp(phone: str, apikey: str, text: str) -> None:
    params = urllib.parse.urlencode({"phone": phone, "text": text, "apikey": apikey})
    url = f"https://api.callmebot.com/whatsapp.php?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "LiftMonitorCloud/1.0"})
    with urllib.request.urlopen(req, timeout=20) as response:
        body = response.read().decode("utf-8", errors="replace")
        if response.status >= 400:
            raise RuntimeError(f"WhatsApp API error: HTTP {response.status} {body[:200]}")


def build_message(name: str, status: str, details: str, source_url: str, sub_changes: list[str]) -> str:
    prefix = "DEFEKT" if status == "broken" else ("WIEDER OK" if status == "working" else "STATUS")
    lines = [
        "Aufzugs-Monitor Berlin",
        f"{prefix}: {name}",
        details,
    ]
    if sub_changes:
        lines.append("Änderungen:")
        lines.extend(sub_changes)
    lines.append(source_url)
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    phone = os.getenv("WHATSAPP_PHONE", "").strip()
    apikey = os.getenv("WHATSAPP_APIKEY", "").strip()
    if not phone or not apikey:
        print("Missing WHATSAPP_PHONE or WHATSAPP_APIKEY.")
        return 2

    if args.test_message.strip():
        test_text = f"Aufzugs-Monitor Cloud Test\n{args.test_message.strip()}"
        if args.dry_run:
            print(f"[DRY] Would send WhatsApp test:\n{test_text}")
        else:
            send_whatsapp(phone, apikey, test_text)
            print("WhatsApp test message sent.")
        if args.test_only:
            return 0

    config = read_json(Path(args.config), default={})
    lifts = config.get("lifts", [])
    if not lifts:
        print("No lifts configured.")
        return 2

    state_path = Path(args.state_file)
    state = read_json(state_path, default={"stations": {}})
    stations = state.setdefault("stations", {})
    now = datetime.now(timezone.utc).isoformat()

    sent = 0
    for lift in lifts:
        station_id = lift.get("id") or re.sub(r"[^a-z0-9]+", "-", lift.get("name", "").lower()).strip("-")
        name = lift.get("name", station_id)
        source_url = lift.get("url", "")
        station_url = normalize_station_url(source_url)
        if not station_url:
            continue

        try:
            raw = fetch_text(station_url)
            sub_lifts = parse_station_slides(raw, station_url)
            status, details = aggregate_station(sub_lifts)
            prev_entry = stations.get(station_id)
            prev_status = (prev_entry or {}).get("status")
            prev_sub = (prev_entry or {}).get("sub_lifts", [])
            changed = prev_status is not None and prev_status != status
            sub_changes = collect_sub_lift_changes(prev_sub, sub_lifts) if prev_entry else []
            relevant = changed or bool(sub_changes)

            stations[station_id] = {
                "name": name,
                "url": source_url,
                "status": status,
                "details": details,
                "sub_lifts": sub_lifts,
                "checked_at": now,
            }

            if relevant:
                message = build_message(name, status, details, source_url, sub_changes)
                if args.dry_run:
                    print(f"[DRY] Would send WhatsApp:\n{message}\n")
                else:
                    send_whatsapp(phone, apikey, message)
                    sent += 1
                    print(f"Sent WhatsApp for {name}")
        except Exception as err:  # noqa: BLE001
            print(f"ERROR checking {name}: {err}")

    state["last_check_finished_at"] = now
    write_json(state_path, state)
    print(f"Done. Sent {sent} message(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
