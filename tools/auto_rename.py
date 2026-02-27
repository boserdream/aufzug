#!/usr/bin/env python3
import argparse
import datetime as dt
import re
import sys
from pathlib import Path

GENERIC_PATTERNS = [
    re.compile(r"^scan", re.IGNORECASE),
    re.compile(r"^img[_-]?\d*", re.IGNORECASE),
    re.compile(r"^image[_-]?\d*", re.IGNORECASE),
    re.compile(r"^dsc[_-]?\d*", re.IGNORECASE),
    re.compile(r"^document", re.IGNORECASE),
    re.compile(r"^dokument", re.IGNORECASE),
    re.compile(r"^untitled", re.IGNORECASE),
    re.compile(r"^new[_\s-]?file", re.IGNORECASE),
    re.compile(r"^\d{6,}$"),
]


def sanitize_stem(stem: str) -> str:
    replacements = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue"}
    cleaned = stem
    for src, dst in replacements.items():
        cleaned = cleaned.replace(src, dst)
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", cleaned)
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or "Datei"


def looks_generic(stem: str) -> bool:
    return any(pattern.search(stem) for pattern in GENERIC_PATTERNS)


def unique_target(target: Path) -> Path:
    if not target.exists():
        return target
    for idx in range(2, 10000):
        candidate = target.with_name(f"{target.stem}_{idx}{target.suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Kein freier Dateiname gefunden fuer {target}")


def build_name(path: Path, index: int, date_format: str, pattern: str) -> str:
    file_date = dt.datetime.fromtimestamp(path.stat().st_mtime).strftime(date_format)
    stem = sanitize_stem(path.stem)
    ext = path.suffix.lower()
    try:
        name = pattern.format(date=file_date, stem=stem, index=index, ext=ext)
    except KeyError as exc:
        raise ValueError(f"Ungueltiger Platzhalter im Pattern: {exc}") from exc

    if not name.lower().endswith(ext):
        name = f"{name}{ext}"
    name = sanitize_stem(Path(name).stem) + ext
    return name


def iter_files(base_dir: Path, recursive: bool) -> list[Path]:
    iterator = base_dir.rglob("*") if recursive else base_dir.glob("*")
    return sorted([p for p in iterator if p.is_file()], key=lambda p: p.stat().st_mtime)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Liest Dateien in einem Ordner und benennt sie automatisch um."
    )
    parser.add_argument("--dir", required=True, help="Zielordner mit Dateien")
    parser.add_argument(
        "--pattern",
        default="{date}_{stem}",
        help="Namensschema mit Platzhaltern: {date}, {stem}, {index}, {ext}",
    )
    parser.add_argument(
        "--date-format",
        default="%Y-%m-%d",
        help="Datumsformat fuer {date} (strftime), Standard: %%Y-%%m-%%d",
    )
    parser.add_argument("--recursive", action="store_true", help="Unterordner mitverarbeiten")
    parser.add_argument("--dry-run", action="store_true", help="Nur anzeigen, nichts umbenennen")
    parser.add_argument("--all", action="store_true", help="Alle Dateien umbenennen")
    args = parser.parse_args()

    target_dir = Path(args.dir).expanduser()
    if not target_dir.exists() or not target_dir.is_dir():
        print(f"Ordner nicht gefunden: {target_dir}", file=sys.stderr)
        return 2

    files = iter_files(target_dir, recursive=args.recursive)
    counter = 0
    renamed = 0
    for path in files:
        if not args.all and not looks_generic(path.stem):
            continue

        counter += 1
        new_name = build_name(path, counter, args.date_format, args.pattern)
        target = unique_target(path.with_name(new_name))

        if target.resolve() == path.resolve():
            continue

        if args.dry_run:
            print(f"[DRY-RUN] {path.name} -> {target.name}")
            renamed += 1
            continue

        path.rename(target)
        print(f"{path.name} -> {target.name}")
        renamed += 1

    if renamed == 0:
        print("Keine passenden Dateien gefunden.")
    else:
        print(f"Umbenannt: {renamed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
