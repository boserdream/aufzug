#!/usr/bin/env python3
import argparse
import http.cookiejar
import json
import re
import sys
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.parse import quote, urljoin
from urllib.request import HTTPCookieProcessor, Request, build_opener


DEFAULT_CONFIG = {
    "keywordsMust": [],
    "keywordsNice": [],
    "excludeKeywords": [],
    "locationsPreferred": [],
    "remoteOnly": False,
    "minimumScore": 1,
    "maxResults": 20,
    "lookbackDays": 14,
    "allowedSources": [],
    "strictLocations": [],
    "interamtSearchUrl": "https://interamt.de/koop/app/trefferliste?5",
}

COOKIE_JAR = http.cookiejar.CookieJar()
HTTP_OPENER = build_opener(HTTPCookieProcessor(COOKIE_JAR))


def fetch_text(url: str) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": "job-finder-script/1.0",
            "Accept": "text/html,application/xhtml+xml,application/json",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.6",
            "Connection": "keep-alive",
        },
    )
    with HTTP_OPENER.open(req, timeout=25) as r:
        return r.read().decode("utf-8", errors="replace")


def fetch_json(url: str):
    return json.loads(fetch_text(url))


def norm(v) -> str:
    return str(v or "").lower()


def strip_html(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", unescape(s or ""))).strip()


def clean_job_title(s: str) -> str:
    t = strip_html(s)
    t = re.sub(r"\.[a-z0-9_-]+\{[^}]*\}", " ", t, flags=re.I)
    t = re.sub(r"@media\s+[^{]+\{[^}]*\}", " ", t, flags=re.I)
    # Drop typical injected tracking/script fragments from some job portals.
    t = re.sub(r"\bvar\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*.*$", " ", t, flags=re.I)
    t = re.sub(r"\bdocument\.addEventListener\([^)]*\).*$", " ", t, flags=re.I)
    t = re.sub(r"\bwindow\.Livewire[^.]*.*$", " ", t, flags=re.I)
    t = re.sub(r"\btrackImpression\w*.*$", " ", t, flags=re.I)
    t = re.sub(r"\bGoodCompany\b.*?(?=Referent|Manager|Leitung|Projekt|$)", " ", t, flags=re.I)
    t = re.sub(r"\bZu den Ersten gehören\b.*$", " ", t, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) > 220:
        t = t[:220].rsplit(" ", 1)[0].strip()
    return t


def abs_url(base: str, maybe_rel: str) -> str:
    try:
        return urljoin(base, maybe_rel)
    except Exception:
        return maybe_rel


def infer_company_from_title(text: str, fallback: str) -> str:
    raw = strip_html(text)
    if not raw:
        return fallback
    candidates = []
    for pat in [
        r"(?i)\bbei\s+(.+)$",
        r"\s[-|]\s(.+)$",
        r"\s@\s(.+)$",
    ]:
        m = re.search(pat, raw)
        if m:
            candidates.append(m.group(1).strip())

    for c in candidates:
        c = re.sub(r"\s+", " ", c).strip(" -|,;")
        if not c:
            continue
        if re.search(r"job|stelle|referent|manager|leitung|projekt|koordination|sachbearbeiter", c, re.I):
            continue
        if re.search(r"\b(berlin|potsdam|deutschland|hybrid|remote)\b", c, re.I):
            c = re.sub(r"\b(berlin|potsdam|deutschland|hybrid|remote)\b", "", c, flags=re.I).strip(" ,-/")
        if len(c) >= 2:
            return c
    return fallback


def normalize_location(loc) -> str:
    if isinstance(loc, str):
        return strip_html(loc)
    if isinstance(loc, list):
        parts = [normalize_location(x) for x in loc]
        parts = [p for p in parts if p]
        # keep order, drop duplicates
        seen = set()
        out = []
        for p in parts:
            k = norm(p)
            if k in seen:
                continue
            seen.add(k)
            out.append(p)
        return ", ".join(out)
    if isinstance(loc, dict):
        if norm(loc.get("@type")) == "place":
            return normalize_location(loc.get("address") or loc.get("name") or "")
        if norm(loc.get("@type")) == "postaladdress":
            bits = []
            for k in ["addressLocality", "addressRegion", "addressCountry"]:
                v = strip_html(loc.get(k, ""))
                if v:
                    bits.append(v)
            return ", ".join(bits)
        # generic dict fallback
        bits = []
        for k in ["name", "addressLocality", "addressRegion", "addressCountry"]:
            v = strip_html(loc.get(k, ""))
            if v:
                bits.append(v)
        if bits:
            return ", ".join(bits)
    return strip_html(str(loc or ""))


def is_platform_company(name: str) -> bool:
    n = norm(name)
    if not n:
        return True
    platforms = [
        "stepstone",
        "meinestadt",
        "jobware",
        "kimeta",
        "jobrapido",
        "indeed",
        "xing",
        "linkedin",
        "stellenanzeigen",
    ]
    return any(p in n for p in platforms)


def canonical_url(url: str) -> str:
    try:
        p = urlparse(str(url or "").strip())
        if not p.scheme or not p.netloc:
            return str(url or "").strip().lower()
        q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if k.lower() not in {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"}]
        query = urlencode(q)
        path = p.path.rstrip("/") or p.path
        return urlunparse((p.scheme.lower(), p.netloc.lower(), path, "", query, ""))
    except Exception:
        return str(url or "").strip().lower()


def company_fallback_from_url(url: str, default: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
    except Exception:
        return default
    host = re.sub(r"^www\.", "", host)
    if not host:
        return default
    return host


def title_quality(title: str, company: str) -> int:
    t = strip_html(title or "")
    c = strip_html(company or "")
    score = 0
    if len(t) >= 12:
        score += 2
    if re.search(r"referent|manager|leitung|projekt|kommunikation|politik|public|koordination|sachbearbeiter|analyst|consultant", t, re.I):
        score += 3
    if c and norm(t) == norm(c):
        score -= 4
    if re.search(r"gmbh|e\.v\.|ag|kg|mbh|stiftung|verband|universit", t, re.I) and not re.search(r"referent|manager|leitung|projekt|kommunikation|politik", t, re.I):
        score -= 2
    return score


def days_since(iso_dt):
    if not iso_dt:
        return 9999
    try:
        dt = datetime.fromisoformat(str(iso_dt).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int((datetime.now(timezone.utc) - dt).total_seconds() // 86400)
    except Exception:
        return 9999


def source_enabled(config, source_name: str) -> bool:
    allowed = [norm(s) for s in config.get("allowedSources", []) if str(s).strip()]
    if not allowed:
        return True
    return norm(source_name) in allowed


def matches_strict_locations(job, locations) -> bool:
    if not locations:
        return True
    hay = norm(" ".join([job.get("title", ""), job.get("location", ""), job.get("description", ""), job.get("url", "")]))
    return any(norm(loc) in hay for loc in locations)


def parse_jsonld_jobs(html: str, source: str, base: str):
    out = []
    scripts = re.findall(
        r"<script[^>]*type=[\"']application/ld\+json[\"'][^>]*>([\s\S]*?)</script>",
        html,
        flags=re.I,
    )
    for raw in scripts:
        try:
            obj = json.loads(raw.strip())
        except Exception:
            continue
        nodes = obj if isinstance(obj, list) else obj.get("@graph", [obj]) if isinstance(obj, dict) else []
        for n in nodes:
            if not isinstance(n, dict) or n.get("@type") != "JobPosting":
                continue
            org = n.get("hiringOrganization") or {}
            loc = n.get("jobLocation") or n.get("applicantLocationRequirements") or {}
            loc_text = normalize_location(loc)
            url = abs_url(base, n.get("url") or n.get("directApply") or "")
            title = strip_html(n.get("title", ""))
            if not title or not url:
                continue
            company = strip_html(org.get("name", source) if isinstance(org, dict) else source)
            if norm(source) == "stepstone" and is_platform_company(company):
                company = infer_company_from_title(title, company)
            out.append(
                {
                    "source": source,
                    "title": title,
                    "company": company,
                    "location": strip_html(loc_text),
                    "remote": bool(re.search(r"remote|home\s?office", json.dumps(n, ensure_ascii=False), re.I)),
                    "tags": [],
                    "description": strip_html(n.get("description", "")),
                    "url": url,
                    "publishedAt": n.get("datePosted"),
                }
            )
    return out


def parse_anchor_jobs(html: str, source: str, base: str):
    out = []
    seen = set()
    for href, label in re.findall(r"<a[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\s\S]*?)</a>", html, flags=re.I):
        text = clean_job_title(label)
        if len(text) < 8:
            continue
        probe = f"{text} {href}"
        if not re.search(r"job|stelle|stellen|referent|manager|leitung|projekt|koordination|sachbearbeiter", probe, re.I):
            continue
        url = abs_url(base, href)
        key = f"{norm(url)}|{norm(text)}"
        if key in seen:
            continue
        seen.add(key)
        company = infer_company_from_title(text, source)
        out.append(
            {
                "source": source,
                "title": text,
                "company": company,
                "location": "",
                "remote": bool(re.search(r"remote|home\s?office", text, re.I)),
                "tags": [],
                "description": "",
                "url": url,
                "publishedAt": None,
            }
        )
    return out


def title_from_job_url(url: str) -> str:
    try:
        p = urlparse(url)
        slug = p.path.rsplit("/", 1)[-1]
        slug = re.sub(r"\.html?$", "", slug, flags=re.I)
        slug = re.sub(r"-de-j\d+$", "", slug, flags=re.I)
        slug = re.sub(r"[-_]+", " ", slug).strip()
        slug = re.sub(r"\s+", " ", slug)
        return slug.title() if slug else ""
    except Exception:
        return ""


def parse_karriereportal_berlin_jobs(html: str, base: str):
    out = []
    seen = set()

    # 1) Anchor-based extraction with looser rules than generic parser.
    for m in re.finditer(r"<a([^>]*?)href=[\"']([^\"']+)[\"']([^>]*)>([\s\S]*?)</a>", html, flags=re.I):
        attrs_l = (m.group(1) or "") + " " + (m.group(3) or "")
        href = m.group(2) or ""
        inner = m.group(4) or ""
        text = clean_job_title(inner)
        if not text:
            t_m = re.search(r"title=[\"']([^\"']+)[\"']", attrs_l, flags=re.I)
            if t_m:
                text = clean_job_title(t_m.group(1))

        url = abs_url(base, href)
        low_url = norm(url)
        if "karriereportal-stellen.berlin.de" not in low_url:
            continue

        likely_job_url = bool(
            re.search(r"stellen|job|vakanz|ausschreibung|-de-j\d+|/de/jobs?/|/de/stellen", low_url, flags=re.I)
        )
        if not likely_job_url:
            continue
        if len(text) < 6:
            text = title_from_job_url(url)
        if len(text) < 6:
            continue
        if re.search(r"impressum|datenschutz|kontakt|newsletter|barrierefrei|hilfe|login|registr", text, re.I):
            continue

        key = canonical_url(url)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "source": "KarriereportalBerlin",
                "title": text,
                "company": "Land Berlin",
                "location": "Berlin",
                "remote": False,
                "tags": [],
                "description": "",
                "url": url,
                "publishedAt": None,
            }
        )

    # 2) URL-pattern fallback for JS-rendered pages.
    for url in re.findall(r"https?://[^\s\"']*karriereportal-stellen\.berlin\.de[^\s\"']+", html, flags=re.I):
        if not re.search(r"stellen|job|vakanz|ausschreibung|-de-j\d+|/de/jobs?/|/de/stellen", url, flags=re.I):
            continue
        key = canonical_url(url)
        if key in seen:
            continue
        seen.add(key)
        title = title_from_job_url(url) or "Stellenangebot (Land Berlin)"
        out.append(
            {
                "source": "KarriereportalBerlin",
                "title": clean_job_title(title),
                "company": "Land Berlin",
                "location": "Berlin",
                "remote": False,
                "tags": [],
                "description": "",
                "url": url,
                "publishedAt": None,
            }
        )

    return out


def fetch_karriereportal_berlin_jobs():
    jobs = []
    urls = [
        "https://www.karriereportal-stellen.berlin.de/stellenangebote.html?filter%5Bvolltext%5D=",
        "https://www.karriereportal-stellen.berlin.de/stellenangebote.html?filter%5Bvolltext%5D=referent",
    ]
    for u in urls:
        html = fetch_text(u)
        jobs.extend(parse_karriereportal_berlin_jobs(html, u))
    return jobs


def fetch_sources(config):
    jobs = []
    warnings = []
    if source_enabled(config, "Arbeitnow"):
        try:
            for p in [1, 2, 3]:
                body = fetch_json(f"https://www.arbeitnow.com/api/job-board-api?page={p}")
                for i in body.get("data", []):
                    jobs.append(
                        {
                            "source": "Arbeitnow",
                            "title": i.get("title", ""),
                            "company": i.get("company_name", ""),
                            "location": i.get("location") or ("Remote" if i.get("remote") else ""),
                            "remote": bool(i.get("remote")),
                            "tags": i.get("tags", []),
                            "description": i.get("description", ""),
                            "url": i.get("url", ""),
                            "publishedAt": i.get("created_at"),
                        }
                    )
                if not (body.get("links") or {}).get("next"):
                    break
        except Exception as e:
            warnings.append(f"Arbeitnow fehlgeschlagen: {e}")

    if source_enabled(config, "Remotive"):
        try:
            body = fetch_json("https://remotive.com/api/remote-jobs")
            for i in body.get("jobs", []):
                loc = i.get("candidate_required_location", "")
                jobs.append(
                    {
                        "source": "Remotive",
                        "title": i.get("title", ""),
                        "company": i.get("company_name", ""),
                        "location": loc,
                        "remote": True,
                        "tags": i.get("tags", []),
                        "description": i.get("description", ""),
                        "url": i.get("url", ""),
                        "publishedAt": i.get("publication_date"),
                    }
                )
        except Exception as e:
            warnings.append(f"Remotive fehlgeschlagen: {e}")

    interamt_url = str(config.get("interamtSearchUrl") or "https://interamt.de/koop/app/trefferliste?5").strip()

    for source, urls in [
        ("GesinesJobtipps", ["https://gesinesjobtipps.de/region/berlin-und-umgebung/"]),
        ("Interamt", [interamt_url]),
        ("BundService", ["https://bund.service.de/", "https://service.bund.de/"]),
        ("BMWK", ["https://www.bundeswirtschaftsministerium.de/Navigation/DE/Ministerium/Stellenangebote/stellenangebote.html"]),
        ("BMG", ["https://www.bundesgesundheitsministerium.de/ministerium/karriere/stellenangebote"]),
        ("BMI", ["https://www.bmi.bund.de/DE/service/stellenangebote/stellenangebote-node.html"]),
        ("BMBFSFJ", ["https://www.bmbfsfj.bund.de/bmbfsfj/ministerium/bmbfsfj-als-arbeitgeber/ausschreibungen"]),
        ("BMDS", ["https://bmds.bund.de/ministerium/bmds-als-arbeitgeber"]),
        ("BMF", ["https://www.bundesfinanzministerium.de/Web/DE/Ministerium/Arbeiten-Ausbildung/Stellenangebote/stellenangebote.html"]),
        ("Arbeitsagentur", ["https://www.arbeitsagentur.de/jobsuche/suche?angebotsart=1&wo=Berlin"]),
        ("LinkedInJobs", ["https://de.linkedin.com/jobs/search/?keywords=Public%20Affairs&location=Berlin"]),
        ("GoodJobs", ["https://goodjobs.eu/jobs"]),
    ]:
        if not source_enabled(config, source):
            continue
        for u in urls:
            try:
                html = fetch_text(u)
                jobs.extend(parse_jsonld_jobs(html, source, u))
                if source == "KarriereportalBerlin":
                    jobs.extend(parse_karriereportal_berlin_jobs(html, u))
                else:
                    jobs.extend(parse_anchor_jobs(html, source, u))
            except Exception as e:
                warnings.append(f"{source} fehlgeschlagen: {e}")

    if source_enabled(config, "KarriereportalBerlin"):
        try:
            jobs.extend(fetch_karriereportal_berlin_jobs())
        except Exception as e:
            warnings.append(f"KarriereportalBerlin fehlgeschlagen: {e}")

    if source_enabled(config, "StepStone"):
        try:
            kw = quote((config.get("keywordsMust") or ["politik"])[0])
            loc_pref = "-".join([l for l in config.get("locationsPreferred", []) if re.search(r"berlin|potsdam", l, re.I)]) or "berlin"
            url = f"https://www.stepstone.de/jobs/{kw}/in-{quote(loc_pref)}"
            html = fetch_text(url)
            jobs.extend(parse_jsonld_jobs(html, "StepStone", url))
            jobs.extend(parse_anchor_jobs(html, "StepStone", url))
        except Exception as e:
            warnings.append(f"StepStone fehlgeschlagen: {e}")

    return jobs, warnings


def extract_meta_description(html: str) -> str:
    m = re.search(r"<meta[^>]+(?:name|property)=[\"'](?:description|og:description)[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>", html, flags=re.I)
    return strip_html(m.group(1)) if m else ""


def infer_location_from_text(*parts) -> str:
    t = norm(" ".join([p for p in parts if p]))
    if "berlin" in t:
        return "Berlin"
    if "potsdam" in t:
        return "Potsdam"
    return ""


def enrich_gesines_jobs(jobs, warnings, max_to_enrich: int = 40):
    cache = {}
    enriched = 0
    out = []
    for j in jobs:
        if norm(j.get("source")) != "gesinesjobtipps" or not str(j.get("url") or "").startswith("http"):
            out.append(j)
            continue
        if enriched >= max_to_enrich:
            out.append(j)
            continue
        enriched += 1

        url = str(j.get("url") or "")
        patch = cache.get(url)
        if patch is None:
            patch = {}
            try:
                html = fetch_text(url)
                detail = parse_jsonld_jobs(html, "GesinesJobtipps", url)
                best = None
                for d in detail:
                    if norm(d.get("title")) == norm(j.get("title")):
                        best = d
                        break
                if best is None and detail:
                    best = detail[0]
                meta_desc = extract_meta_description(html)
                body_hint = strip_html(html)[:8000]

                if best:
                    if str(best.get("company") or "").strip() and norm(best.get("company")) != "gesinesjobtipps":
                        patch["company"] = best.get("company")
                    if str(best.get("location") or "").strip():
                        patch["location"] = best.get("location")
                    if str(best.get("publishedAt") or "").strip():
                        patch["publishedAt"] = best.get("publishedAt")
                    if str(best.get("description") or "").strip():
                        patch["description"] = best.get("description")

                if not patch.get("description") and meta_desc:
                    patch["description"] = meta_desc
                if not patch.get("location"):
                    loc = infer_location_from_text((best or {}).get("location", ""), meta_desc, body_hint)
                    if loc:
                        patch["location"] = loc
            except Exception as e:
                warnings.append(f"GesinesJobtipps-Detail fehlgeschlagen ({url}): {e}")
            cache[url] = patch

        merged = dict(j)
        for k in ["company", "location", "publishedAt", "description", "remote"]:
            if patch.get(k):
                merged[k] = patch[k]
        if norm(merged.get("company")) == "gesinesjobtipps":
            merged["company"] = company_fallback_from_url(merged.get("url", ""), merged.get("company", "GesinesJobtipps"))
        out.append(merged)
    return out


def enrich_stepstone_jobs(jobs, warnings):
    for j in jobs:
        if norm(j.get("source")) != "stepstone":
            continue
        needs_company = norm(j.get("company")) in {"", "stepstone"}
        needs_location = not str(j.get("location") or "").strip()
        needs_date = not str(j.get("publishedAt") or "").strip()
        if not (needs_company or needs_location or needs_date):
            continue

        url = str(j.get("url") or "")
        if "stepstone.de/job/" not in url and "stepstone.de/stellenangebote" not in url:
            continue

        try:
            html = fetch_text(url)
            detail_jobs = parse_jsonld_jobs(html, "StepStone", url)
            if not detail_jobs:
                continue
            d = detail_jobs[0]
            if needs_company and str(d.get("company") or "").strip():
                j["company"] = d.get("company")
            if needs_location and str(d.get("location") or "").strip():
                j["location"] = d.get("location")
            if needs_date and str(d.get("publishedAt") or "").strip():
                j["publishedAt"] = d.get("publishedAt")
            if not str(j.get("description") or "").strip() and str(d.get("description") or "").strip():
                j["description"] = d.get("description")
        except Exception as e:
            warnings.append(f"StepStone-Detail fehlgeschlagen ({url}): {e}")


def dedupe_and_merge_jobs(jobs):
    buckets = {}
    for j in jobs:
        key = canonical_url(j.get("url", "")) or f"{norm(j.get('title'))}|{norm(j.get('company'))}"
        buckets.setdefault(key, []).append(j)

    out = []
    for _, group in buckets.items():
        best = group[0]
        for cand in group[1:]:
            if title_quality(cand.get("title", ""), cand.get("company", "")) > title_quality(best.get("title", ""), best.get("company", "")):
                best = cand

        merged = dict(best)
        # Fill missing fields from siblings with same URL.
        for sib in group:
            for field in ["company", "location", "publishedAt", "description", "url"]:
                if (not str(merged.get(field) or "").strip()) and str(sib.get(field) or "").strip():
                    merged[field] = sib.get(field)
            if not merged.get("remote") and sib.get("remote"):
                merged["remote"] = True

        # If title equals company, try to pick a better title from siblings.
        if norm(merged.get("title")) == norm(merged.get("company")):
            for sib in group:
                if title_quality(sib.get("title", ""), merged.get("company", "")) > title_quality(merged.get("title", ""), merged.get("company", "")):
                    merged["title"] = sib.get("title")

        out.append(merged)
    return out


def score(job, config):
    hay = norm(" ".join([job.get("title", ""), job.get("company", ""), job.get("location", ""), " ".join(job.get("tags", []) or []), job.get("description", "")]))
    must = [k for k in config["keywordsMust"] if norm(k) in hay]
    nice = [k for k in config["keywordsNice"] if norm(k) in hay]
    excl = [k for k in config["excludeKeywords"] if norm(k) in hay]
    loc = [k for k in config["locationsPreferred"] if norm(k) in norm(job.get("location", ""))]
    sc = len(must) * 5 + len(nice) * 2 + len(loc) * 3 + (2 if job.get("remote") else 0)
    if job["ageDays"] <= 3:
        sc += 2
    elif job["ageDays"] <= 7:
        sc += 1
    sc -= len(excl) * 10
    if config["keywordsMust"] and not must:
        sc = -999
    job["reasons"] = []
    if must:
        job["reasons"].append("must: " + ", ".join(must))
    if nice:
        job["reasons"].append("nice: " + ", ".join(nice))
    if loc:
        job["reasons"].append("ort: " + ", ".join(loc))
    if job.get("remote"):
        job["reasons"].append("remote")
    if excl:
        job["reasons"].append("exclude: " + ", ".join(excl))
    job["score"] = sc
    return job


def contains_excluded(job, config) -> bool:
    hay = norm(
        " ".join(
            [
                job.get("title", ""),
                job.get("company", ""),
                job.get("location", ""),
                " ".join(job.get("tags", []) or []),
                job.get("description", ""),
            ]
        )
    )
    return any(norm(k) in hay for k in config.get("excludeKeywords", []))


def is_obvious_non_job(job) -> bool:
    title = strip_html(job.get("title", ""))
    url = str(job.get("url") or "").strip().lower()
    source = norm(job.get("source", ""))
    if not title:
        return True
    if source == "gesinesjobtipps" and norm(title) in {"gesines jobtipps", "gesinesjobtipps"}:
        return True
    if title.startswith("Bundesportal: Erledigen Sie Ihre Behördengänge online"):
        return True
    # drop source homepages without clear job slug/path
    if source == "gesinesjobtipps" and (url.rstrip("/") in {"https://gesinesjobtipps.de", "https://gesinesjobtipps.de/jobs", "https://gesinesjobtipps.de/region/berlin-und-umgebung"}):
        return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--out")
    ap.add_argument("--json")
    args = ap.parse_args()

    cfg = DEFAULT_CONFIG.copy()
    cfg.update(json.loads(Path(args.config).read_text(encoding="utf-8")))

    jobs, warnings = fetch_sources(cfg)
    jobs = enrich_gesines_jobs(jobs, warnings)
    deduped = dedupe_and_merge_jobs(jobs)
    for j in deduped:
        j["ageDays"] = days_since(j.get("publishedAt"))

    enrich_stepstone_jobs(deduped, warnings)
    for j in deduped:
        j["ageDays"] = days_since(j.get("publishedAt"))

    filtered = [j for j in deduped if (j["ageDays"] <= cfg["lookbackDays"] or j["ageDays"] == 9999)]
    filtered = [j for j in filtered if source_enabled(cfg, j.get("source", ""))]
    filtered = [j for j in filtered if matches_strict_locations(j, cfg.get("strictLocations", []))]
    filtered = [j for j in filtered if not contains_excluded(j, cfg)]
    filtered = [j for j in filtered if not is_obvious_non_job(j)]
    if cfg["remoteOnly"]:
        filtered = [j for j in filtered if j.get("remote")]

    ranked = [score(j, cfg) for j in filtered]
    ranked = [j for j in ranked if j["score"] >= cfg["minimumScore"]]
    ranked.sort(key=lambda x: x["score"], reverse=True)
    ranked = ranked[: int(cfg["maxResults"])]

    for w in warnings:
        print(f"[Warnung] {w}", file=sys.stderr)
    print(f"Gesamt: {len(deduped)}, aktuell: {len(filtered)}, Treffer: {len(ranked)}")
    for i, j in enumerate(ranked, 1):
        print(f"{i}. [{j['score']}] {j['title']} @ {j['company']} ({j.get('location') or 'n/a'})")
        print(f"   {j.get('url')}")

    if args.out:
        lines = ["# Job-Finder Ergebnis", "", f"Profil: `{args.config}`", f"Erstellt: {datetime.now().isoformat()}", ""]
        if not ranked:
            lines.append("Keine Treffer. Passe ggf. `minimumScore` oder Keywords an.")
        else:
            for i, j in enumerate(ranked, 1):
                lines.extend(
                    [
                        f"## {i}. {j['title']} ({j['company']})",
                        f"- Score: **{j['score']}**",
                        f"- Quelle: {j['source']}",
                        f"- Ort: {j.get('location') or 'unbekannt'}",
                        f"- Veröffentlicht vor: {j['ageDays']} Tagen",
                        f"- Gründe: {' | '.join(j.get('reasons') or ['keine'])}",
                        f"- Link: {j.get('url')}",
                        "",
                    ]
                )
        Path(args.out).write_text("\n".join(lines), encoding="utf-8")

    if args.json:
        Path(args.json).write_text(json.dumps(ranked, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
