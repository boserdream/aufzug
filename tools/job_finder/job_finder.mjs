#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_CONFIG = {
  keywordsMust: [],
  keywordsNice: [],
  excludeKeywords: [],
  locationsPreferred: [],
  remoteOnly: false,
  minimumScore: 1,
  maxResults: 20,
  lookbackDays: 14,
  allowedSources: [],
  strictLocations: [],
};

function parseArgs(argv) {
  const args = { config: null, out: null, json: null, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--config') args.config = argv[++i];
    else if (token === '--out') args.out = argv[++i];
    else if (token === '--json') args.json = argv[++i];
    else if (token === '--help' || token === '-h') args.help = true;
    else throw new Error(`Unbekanntes Argument: ${token}`);
  }
  return args;
}

function printHelp() {
  console.log(`Job Finder\n\nUsage:\n  node tools/job_finder/job_finder.mjs --config tools/job_finder/job_profile.json [--out jobs.md] [--json jobs.json]\n\nOptionen:\n  --config   Pfad zur JSON-Profil-Datei\n  --out      Optional: Markdown-Ausgabe\n  --json     Optional: JSON-Ausgabe\n  --help     Hilfe anzeigen`);
}

async function readConfig(configPath) {
  const raw = await fs.readFile(configPath, 'utf8');
  const cfg = JSON.parse(raw);
  return { ...DEFAULT_CONFIG, ...cfg };
}

function norm(value) {
  return String(value ?? '').toLowerCase();
}

function scoreJob(job, config) {
  const haystack = norm([
    job.title,
    job.company,
    job.location,
    ...(job.tags || []),
    job.description,
  ].join(' '));

  const mustMatches = config.keywordsMust.filter((kw) => haystack.includes(norm(kw)));
  const niceMatches = config.keywordsNice.filter((kw) => haystack.includes(norm(kw)));
  const excludedMatches = config.excludeKeywords.filter((kw) => haystack.includes(norm(kw)));
  const preferredLocationMatches = config.locationsPreferred.filter((loc) => norm(job.location).includes(norm(loc)));

  let score = 0;
  score += mustMatches.length * 5;
  score += niceMatches.length * 2;
  score += preferredLocationMatches.length * 3;
  if (job.remote) score += 2;
  if (job.ageDays <= 3) score += 2;
  else if (job.ageDays <= 7) score += 1;
  score -= excludedMatches.length * 10;

  if (config.keywordsMust.length > 0 && mustMatches.length === 0) {
    return { ...job, score: -999, reasons: ['kein Pflicht-Keyword'] };
  }

  const reasons = [];
  if (mustMatches.length) reasons.push(`must: ${mustMatches.join(', ')}`);
  if (niceMatches.length) reasons.push(`nice: ${niceMatches.join(', ')}`);
  if (preferredLocationMatches.length) reasons.push(`ort: ${preferredLocationMatches.join(', ')}`);
  if (job.remote) reasons.push('remote');
  if (excludedMatches.length) reasons.push(`exclude: ${excludedMatches.join(', ')}`);

  return { ...job, score, reasons };
}

function containsExcluded(job, config) {
  const haystack = norm([
    job.title,
    job.company,
    job.location,
    ...(job.tags || []),
    job.description,
  ].join(' '));
  return (config.excludeKeywords || []).some((kw) => haystack.includes(norm(kw)));
}

function daysSince(isoDate) {
  if (!isoDate) return 9999;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 9999;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function sourceEnabled(config, sourceName) {
  const allowed = (config.allowedSources || []).map((s) => norm(s)).filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(norm(sourceName));
}

function matchesStrictLocations(job, strictLocations) {
  if (!strictLocations || strictLocations.length === 0) return true;
  const haystack = norm([job.title, job.location, job.description, job.url].join(' '));
  return strictLocations.some((loc) => haystack.includes(norm(loc)));
}

function canonicalUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const drop = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref']);
    const kept = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (!drop.has(norm(k))) kept.push([k, v]);
    }
    kept.sort((a, b) => `${a[0]}=${a[1]}`.localeCompare(`${b[0]}=${b[1]}`));
    const q = kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const cleanPath = (u.pathname || '/').replace(/\/+$/, '') || '/';
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${cleanPath}${q ? `?${q}` : ''}`;
  } catch {
    return raw.toLowerCase();
  }
}

function decodeHtmlEntities(input) {
  return String(input ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/');
}

function stripHtml(input) {
  return decodeHtmlEntities(String(input ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function cleanJobTitle(input) {
  let t = stripHtml(input);
  t = t.replace(/\.[a-z0-9_-]+\{[^}]*\}/gi, ' ');
  t = t.replace(/@media\s+[^{]+\{[^}]*\}/gi, ' ');
  t = t.replace(/\bvar\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=.*$/i, ' ');
  t = t.replace(/\bdocument\.addEventListener\([^)]*\).*$/i, ' ');
  t = t.replace(/\bwindow\.Livewire.*$/i, ' ');
  t = t.replace(/\btrackImpression\w*.*$/i, ' ');
  t = t.replace(/\bGoodCompany\b.*?(?=Referent|Manager|Leitung|Projekt|$)/i, ' ');
  t = t.replace(/\bZu den Ersten gehören\b.*$/i, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > 220) t = t.slice(0, 220).trim();
  return t;
}

function isObviousNonJob(job) {
  const title = cleanJobTitle(job?.title || '');
  const source = norm(job?.source || '');
  const url = String(job?.url || '').toLowerCase().trim();
  if (!title || title.length < 6) return true;
  if (source === 'gesinesjobtipps' && ['gesines jobtipps', 'gesinesjobtipps'].includes(norm(title))) return true;
  if (/^(passwort vergessen\??|stellensuche|stellenangebote)$/i.test(title)) return true;
  if (/bundesportal: erledigen sie ihre behördengänge online/i.test(title)) return true;
  if (source === 'gesinesjobtipps' && ['https://gesinesjobtipps.de', 'https://gesinesjobtipps.de/jobs', 'https://gesinesjobtipps.de/region/berlin-und-umgebung'].includes(url.replace(/\/+$/, ''))) return true;
  if (source === 'karriereportalberlin' && /(passwort-vergessen|impressum|datenschutz|kontakt|newsletter)/i.test(url)) return true;
  return false;
}

function absUrl(base, maybeRelative) {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

function parseArbeitnow(item) {
  return {
    source: 'Arbeitnow',
    title: item.title,
    company: item.company_name,
    location: item.location || (item.remote ? 'Remote' : ''),
    remote: Boolean(item.remote),
    tags: item.tags || [],
    description: item.description || '',
    url: item.url,
    publishedAt: item.created_at || null,
  };
}

function parseRemotive(item) {
  const loc = item.candidate_required_location || '';
  return {
    source: 'Remotive',
    title: item.title,
    company: item.company_name,
    location: loc,
    remote: true,
    tags: item.tags || [],
    description: item.description || '',
    url: item.url,
    publishedAt: item.publication_date || null,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'job-finder-script/1.0',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} bei ${url}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'job-finder-script/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} bei ${url}`);
  }

  return response.text();
}

async function fetchTextBrowserLike(url, referer = 'https://www.stepstone.de/') {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
      Referer: referer,
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} bei ${url}`);
  }
  return response.text();
}

function mergeCookieHeader(existing, setCookies) {
  const jar = new Map();
  const addPair = (pair) => {
    const idx = pair.indexOf('=');
    if (idx <= 0) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (!k) return;
    jar.set(k, v);
  };

  for (const part of String(existing || '').split(';')) {
    const p = part.trim();
    if (!p) continue;
    addPair(p);
  }
  for (const raw of setCookies || []) {
    const first = String(raw || '').split(';')[0].trim();
    if (!first) continue;
    addPair(first);
  }

  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function readSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

async function fetchTextWithSession(url, maxRedirects = 10) {
  let currentUrl = url;
  let cookieHeader = '';

  for (let i = 0; i < maxRedirects; i += 1) {
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'job-finder-script/1.0',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.6',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });

    cookieHeader = mergeCookieHeader(cookieHeader, readSetCookies(response.headers));

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect ohne Location bei ${currentUrl}`);
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} bei ${currentUrl}`);
    }
    return response.text();
  }

  throw new Error(`Zu viele Redirects bei ${url}`);
}

async function fetchArbeitnow(limitPages = 2) {
  const jobs = [];
  for (let page = 1; page <= limitPages; page += 1) {
    const url = `https://www.arbeitnow.com/api/job-board-api?page=${page}`;
    const body = await fetchJson(url);
    const pageJobs = (body.data || []).map(parseArbeitnow);
    jobs.push(...pageJobs);
    if (!body.links?.next) break;
  }
  return jobs;
}

async function fetchRemotive() {
  const body = await fetchJson('https://remotive.com/api/remote-jobs');
  return (body.jobs || []).map(parseRemotive);
}

function parseJsonLdJobs(html, sourceName, baseUrl) {
  const out = [];
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    const raw = (match[1] || '').trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed)
        ? parsed
        : (parsed['@graph'] && Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed]);
      for (const n of nodes) {
        if (!n || n['@type'] !== 'JobPosting') continue;
        const companyObj = n.hiringOrganization || {};
        const locationObj = n.jobLocation || n.applicantLocationRequirements || {};
        const locationText = Array.isArray(locationObj)
          ? JSON.stringify(locationObj)
          : (locationObj.addressLocality || locationObj.name || JSON.stringify(locationObj));
        const url = absUrl(baseUrl, n.url || n.directApply || '');
        if (!url || !n.title) continue;
        out.push({
          source: sourceName,
          title: stripHtml(n.title),
          company: stripHtml(companyObj.name || sourceName),
          location: stripHtml(locationText || ''),
          remote: /remote|home\s?office/i.test(JSON.stringify(n)),
          tags: [],
          description: stripHtml(n.description || ''),
          url,
          publishedAt: n.datePosted || null,
        });
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return out;
}

function parseAnchorJobs(html, sourceName, baseUrl) {
  const out = [];
  const seen = new Set();
  const anchorRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1] || '';
    const text = cleanJobTitle(match[2] || '');
    if (!text || text.length < 8) continue;
    const looksLikeJob = /(job|stelle|stellen|referent|manager|leitung|berater|project|projekt|koordination|sachbearbeiter)/i.test(text + ' ' + href);
    if (!looksLikeJob) continue;
    const url = absUrl(baseUrl, href);
    const key = `${norm(url)}|${norm(text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: sourceName,
      title: text,
      company: sourceName,
      location: '',
      remote: /remote|home\s?office/i.test(text),
      tags: [],
      description: '',
      url,
      publishedAt: null,
    });
  }
  return out;
}

function titleFromJobUrl(url) {
  try {
    const u = new URL(url);
    let slug = (u.pathname.split('/').pop() || '').replace(/\.html?$/i, '');
    slug = slug.replace(/-de-j\d+$/i, '');
    slug = slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!slug) return '';
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  } catch {
    return '';
  }
}

function parseKarriereportalBerlinJobs(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const anchorRegex = /<a([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRegex.exec(html)) !== null) {
    const attrs = `${m[1] || ''} ${m[3] || ''}`;
    const href = m[2] || '';
    let text = cleanJobTitle(m[4] || '');
    if (!text) {
      const tm = attrs.match(/title=["']([^"']+)["']/i);
      if (tm) text = cleanJobTitle(tm[1]);
    }
    const url = absUrl(baseUrl, href);
    const lowUrl = norm(url);
    if (!lowUrl.includes('karriereportal-stellen.berlin.de')) continue;
    const likely = /(stellen|job|vakanz|ausschreibung|-de-j\d+|\/de\/jobs?\/|\/de\/stellen)/i.test(lowUrl);
    if (!likely) continue;
    if (text.length < 6) text = titleFromJobUrl(url);
    if (text.length < 6) continue;
    if (/(impressum|datenschutz|kontakt|newsletter|barrierefrei|hilfe|login|registr)/i.test(text)) continue;
    const key = norm(url.split('?')[0]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: 'KarriereportalBerlin',
      title: text,
      company: 'Land Berlin',
      location: 'Berlin',
      remote: false,
      tags: [],
      description: '',
      url,
      publishedAt: null,
    });
  }

  const urlMatches = html.match(/https?:\/\/[^\s"']*karriereportal-stellen\.berlin\.de[^\s"']+/gi) || [];
  for (const raw of urlMatches) {
    if (!/(stellen|job|vakanz|ausschreibung|-de-j\d+|\/de\/jobs?\/|\/de\/stellen)/i.test(raw)) continue;
    const key = norm(raw.split('?')[0]);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = cleanJobTitle(titleFromJobUrl(raw) || 'Stellenangebot (Land Berlin)');
    out.push({
      source: 'KarriereportalBerlin',
      title,
      company: 'Land Berlin',
      location: 'Berlin',
      remote: false,
      tags: [],
      description: '',
      url: raw,
      publishedAt: null,
    });
  }
  return out;
}

async function fetchKarriereportalBerlinJobs() {
  const urls = [
    'https://www.karriereportal-stellen.berlin.de/stellenangebote.html?filter%5Bvolltext%5D=',
    'https://www.karriereportal-stellen.berlin.de/stellenangebote.html?filter%5Bvolltext%5D=referent',
  ];
  const jobs = [];
  for (const url of urls) {
    const html = await fetchText(url);
    jobs.push(...parseKarriereportalBerlinJobs(html, url));
  }
  return jobs;
}

async function fetchGesinesJobtipps() {
  const urls = [
    'https://gesinesjobtipps.de/region/berlin-und-umgebung/',
  ];
  const jobs = [];
  for (const url of urls) {
    const html = await fetchText(url);
    jobs.push(...parseJsonLdJobs(html, 'GesinesJobtipps', url));
    jobs.push(...parseAnchorJobs(html, 'GesinesJobtipps', url));
  }
  return jobs;
}

async function fetchInteramt(config) {
  const fromConfig = config.interamtSearchUrl || null;
  const urls = fromConfig ? [String(fromConfig)] : ['https://interamt.de/koop/app/trefferliste?5'];
  const jobs = [];
  for (const url of urls) {
    const html = await fetchTextWithSession(url);
    jobs.push(...parseJsonLdJobs(html, 'Interamt', url));
    jobs.push(...parseAnchorJobs(html, 'Interamt', url));
  }
  return jobs;
}

async function fetchBundService() {
  const urls = [
    'https://bund.service.de/',
    'https://service.bund.de/',
  ];
  return fetchSourceByUrls('BundService', urls);
}

async function fetchSourceByUrls(sourceName, urls) {
  const jobs = [];
  for (const url of urls) {
    const html = await fetchText(url);
    jobs.push(...parseJsonLdJobs(html, sourceName, url));
    if (sourceName === 'KarriereportalBerlin') {
      jobs.push(...parseKarriereportalBerlinJobs(html, url));
    } else {
      jobs.push(...parseAnchorJobs(html, sourceName, url));
    }
  }
  return jobs;
}

async function fetchStepstone(config) {
  const must = (config.keywordsMust || []).map((x) => String(x || '').trim()).filter(Boolean);
  const keyword = must[0] || 'politik';
  const candidates = [
    `https://www.stepstone.de/jobs/${encodeURIComponent(keyword)}/in-berlin`,
    `https://www.stepstone.de/jobs/referent/in-berlin`,
    `https://www.stepstone.de/jobs/public-affairs/in-berlin`,
    `https://www.stepstone.de/jobs/${encodeURIComponent(keyword)}/in-berlin-potsdam`,
  ];
  const jobs = [];
  let success = 0;
  let lastErr = null;
  for (const url of candidates) {
    try {
      const html = await fetchTextBrowserLike(url);
      jobs.push(...parseJsonLdJobs(html, 'StepStone', url));
      jobs.push(...parseAnchorJobs(html, 'StepStone', url));
      success += 1;
    } catch (err) {
      lastErr = err;
    }
  }
  if (success === 0 && lastErr) throw lastErr;
  return jobs;
}

async function fetchStudySmarter(config) {
  const baseApiURL = 'https://talents.studysmarter.de/wp-json/studysmarter/v1';
  const listingUrl = 'https://talents.studysmarter.de/jobs/';
  const params = new URLSearchParams({
    keyword: (config.keywordsMust && config.keywordsMust[0]) ? String(config.keywordsMust[0]) : 'Politik',
    page_number: '1',
    city: 'Berlin',
    job_listing_type: '',
    job_listing_category: '',
    job_listing_tag: '',
    job_listing_company_size: '',
    job_listing_industry: '',
    job_listing_seniority_level: '',
    is_remote_position: '',
    radius: '',
    isResetClicked: 'false',
    easy_apply: '',
    salary_min: '',
    salary_max: '',
    job_age: '',
    premium_only: '',
  });
  const apiUrl = `${baseApiURL.replace(/\/+$/, '')}/jobs/?${params.toString()}`;
  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json,text/plain,*/*',
      Referer: listingUrl,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} bei ${apiUrl}`);
  const body = await response.json();
  const items = Array.isArray(body?.data) ? body.data : [];
  if (!items.length) console.error('[Warnung] StudySmarter: API lieferte 0 Jobs');
  return items.map((it) => {
    const locations = Array.isArray(it?.locations) ? it.locations.filter(Boolean).join(', ') : '';
    const categories = Array.isArray(it?.job_categories) ? it.job_categories.map((x) => x?.name).filter(Boolean) : [];
    const types = Array.isArray(it?.job_types) ? it.job_types.map((x) => x?.name).filter(Boolean) : [];
    const industries = Array.isArray(it?.job_industries) ? it.job_industries.map((x) => x?.name).filter(Boolean) : [];
    const postedRaw = String(it?.posted || '').trim();
    const publishedAt = postedRaw ? postedRaw.replace(' ', 'T') : null;
    return {
      source: 'StudySmarter',
      title: stripHtml(it?.title || ''),
      company: stripHtml(it?.company_name || 'StudySmarter'),
      location: stripHtml(locations),
      remote: /yes|true|remote/i.test(String(it?.is_remote_positions || '')),
      tags: [...categories, ...types, ...industries],
      description: '',
      url: String(it?.link || ''),
      publishedAt,
    };
  }).filter((j) => j.url && j.title);
}

function extractMetaDescription(html) {
  const m = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  return m ? stripHtml(m[1]) : '';
}

function inferLocationFromText(...parts) {
  const t = norm(parts.filter(Boolean).join(' '));
  if (t.includes('berlin')) return 'Berlin';
  if (t.includes('potsdam')) return 'Potsdam';
  return '';
}

async function enrichGesinesJobs(jobs, maxToEnrich = 40) {
  const out = [];
  const cache = new Map();
  let enrichedCount = 0;

  for (const job of jobs) {
    if (norm(job.source) !== 'gesinesjobtipps' || !String(job.url || '').startsWith('http')) {
      out.push(job);
      continue;
    }
    if (enrichedCount >= maxToEnrich) {
      out.push(job);
      continue;
    }
    enrichedCount += 1;

    let patch = cache.get(job.url);
    if (!patch) {
      patch = {};
      try {
        const html = await fetchText(job.url);
        const jsonLd = parseJsonLdJobs(html, job.source, job.url);
        const best = jsonLd.find((x) => norm(x.title) === norm(job.title)) || jsonLd[0] || null;
        const metaDesc = extractMetaDescription(html);
        const textHint = stripHtml(html).slice(0, 8000);

        if (best?.company && norm(best.company) !== norm(job.source)) patch.company = best.company;
        if (best?.location) patch.location = best.location;
        if (best?.publishedAt) patch.publishedAt = best.publishedAt;
        if (best?.description) patch.description = best.description;

        if (!patch.description && metaDesc) patch.description = metaDesc;
        if (!patch.location) {
          const loc = inferLocationFromText(best?.location, metaDesc, textHint);
          if (loc) patch.location = loc;
        }
      } catch {
        // ignore individual detail page errors
      }
      cache.set(job.url, patch);
    }

    out.push({
      ...job,
      company: patch.company || job.company,
      location: patch.location || job.location,
      publishedAt: patch.publishedAt || job.publishedAt,
      description: patch.description || job.description,
      remote: patch.remote || job.remote,
    });
  }

  return out;
}

async function enrichStepstoneJobs(jobs, maxToEnrich = 80) {
  const out = [];
  let enriched = 0;
  const cache = new Map();
  for (const job of jobs) {
    if (norm(job.source) !== 'stepstone') {
      out.push(job);
      continue;
    }
    if (enriched >= maxToEnrich) {
      out.push(job);
      continue;
    }
    const url = String(job.url || '');
    if (!/stepstone\.de\/(job\/|stellenangebote--)/i.test(url)) {
      out.push(job);
      continue;
    }
    enriched += 1;
    let patch = cache.get(url);
    if (!patch) {
      patch = {};
      try {
        const html = await fetchText(url);
        const details = parseJsonLdJobs(html, 'StepStone', url);
        const best = details[0] || null;
        if (best?.company) patch.company = best.company;
        if (best?.location) patch.location = best.location;
        if (best?.publishedAt) patch.publishedAt = best.publishedAt;
        if (best?.description) patch.description = best.description;
      } catch {
        // ignore single detail failures
      }
      cache.set(url, patch);
    }
    out.push({
      ...job,
      company: patch.company || job.company,
      location: patch.location || job.location,
      publishedAt: patch.publishedAt || job.publishedAt,
      description: patch.description || job.description,
    });
  }
  return out;
}

function titleQuality(job) {
  const title = cleanJobTitle(job?.title || '');
  const company = cleanJobTitle(job?.company || '');
  let score = 0;
  if (title.length >= 12) score += 2;
  if (/(referent|manager|leitung|projekt|kommunikation|politik|public|koordination|analyst)/i.test(title)) score += 3;
  if (title && company && norm(title) === norm(company)) score -= 3;
  return score;
}

function dedupeJobs(jobs) {
  const buckets = new Map();
  for (const job of jobs) {
    const key = canonicalUrl(job.url) || `${norm(job.title)}|${norm(job.company)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(job);
  }
  const out = [];
  for (const group of buckets.values()) {
    const best = [...group].sort((a, b) => titleQuality(b) - titleQuality(a))[0];
    const merged = { ...best };
    for (const sib of group) {
      for (const field of ['company', 'location', 'publishedAt', 'description', 'url']) {
        if (!String(merged[field] || '').trim() && String(sib[field] || '').trim()) merged[field] = sib[field];
      }
      if (!merged.remote && sib.remote) merged.remote = true;
    }
    out.push(merged);
  }
  return out;
}

function filterByAge(jobs, lookbackDays) {
  return jobs
    .map((job) => ({ ...job, ageDays: daysSince(job.publishedAt) }))
    .filter((job) => job.ageDays <= lookbackDays || job.ageDays === 9999);
}

function filterRemote(jobs, remoteOnly) {
  return remoteOnly ? jobs.filter((j) => j.remote) : jobs;
}

function applySourceCaps(sortedJobs, maxResults) {
  const caps = new Map([
    ['stepstone', 10],
    ['studysmarter', 10],
    ['gesinesjobtipps', 10],
    ['interamt', 5],
    ['karriereportalberlin', 5],
    ['arbeitsagentur', 5],
    ['goodjobs', 5],
  ]);
  const countBySource = new Map();
  const picked = [];
  const rest = [];
  for (const job of sortedJobs) {
    const source = norm(job.source);
    const cap = caps.has(source) ? caps.get(source) : Number.MAX_SAFE_INTEGER;
    const used = countBySource.get(source) || 0;
    if (used < cap) {
      picked.push(job);
      countBySource.set(source, used + 1);
    } else {
      rest.push(job);
    }
  }
  const out = picked.slice(0, maxResults);
  if (out.length < maxResults) {
    out.push(...rest.slice(0, maxResults - out.length));
  }
  return out;
}

function fillSourceQuotas(scoredAll, selected, maxResults) {
  const quotas = new Map([
    ['stepstone', 10],
    ['studysmarter', 10],
    ['gesinesjobtipps', 10],
  ]);
  const usedUrls = new Set(selected.map((j) => canonicalUrl(j.url) || `${norm(j.title)}|${norm(j.company)}`));
  const out = [...selected];

  const ageForSort = (job) => {
    const age = Number(job?.ageDays);
    return Number.isFinite(age) ? age : 9999;
  };

  const sourceCandidates = new Map();
  for (const [source] of quotas.entries()) {
    const pool = scoredAll
      .filter((j) => norm(j.source) === source)
      .sort((a, b) => {
        // Newer jobs first, then stronger score.
        const ageA = ageForSort(a);
        const ageB = ageForSort(b);
        if (ageA !== ageB) return ageA - ageB;
        return Number(b.score || 0) - Number(a.score || 0);
      });
    sourceCandidates.set(source, pool);
  }

  for (const [source, minCount] of quotas.entries()) {
    let current = out.filter((j) => norm(j.source) === source).length;
    if (current >= minCount) continue;
    for (const cand of sourceCandidates.get(source) || []) {
      const key = canonicalUrl(cand.url) || `${norm(cand.title)}|${norm(cand.company)}`;
      if (usedUrls.has(key)) continue;
      out.push(cand);
      usedUrls.add(key);
      current += 1;
      if (current >= minCount || out.length >= maxResults) break;
    }
    if (out.length >= maxResults) break;
  }
  return out.slice(0, maxResults);
}

function toMarkdown(jobs, configPath) {
  const lines = [];
  lines.push('# Job-Finder Ergebnis');
  lines.push('');
  lines.push(`Profil: \`${configPath}\``);
  lines.push(`Erstellt: ${new Date().toISOString()}`);
  lines.push('');

  if (jobs.length === 0) {
    lines.push('Keine Treffer. Passe ggf. `minimumScore` oder Keywords an.');
    return lines.join('\n');
  }

  jobs.forEach((job, idx) => {
    lines.push(`## ${idx + 1}. ${job.title} (${job.company})`);
    lines.push(`- Score: **${job.score}**`);
    lines.push(`- Quelle: ${job.source}`);
    lines.push(`- Ort: ${job.location || 'unbekannt'}`);
    lines.push(`- Veröffentlicht vor: ${job.ageDays} Tagen`);
    lines.push(`- Gründe: ${job.reasons.join(' | ') || 'keine'}`);
    lines.push(`- Link: ${job.url}`);
    lines.push('');
  });

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.config) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const configPath = path.resolve(args.config);
  const config = await readConfig(configPath);

  const [aJobs, rJobs, gJobs, iJobs, bJobs, bmwkJobs, bmgJobs, bmiJobs, bmbfsfjJobs, bmdsJobs, bmfJobs, sJobs, ssJobs, kpbJobs, baJobs, liJobs, goodJobs] = await Promise.all([
    sourceEnabled(config, 'Arbeitnow')
      ? fetchArbeitnow(3).catch((err) => {
          console.error(`[Warnung] Arbeitnow fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'Remotive')
      ? fetchRemotive().catch((err) => {
          console.error(`[Warnung] Remotive fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'GesinesJobtipps')
      ? fetchGesinesJobtipps().catch((err) => {
          console.error(`[Warnung] GesinesJobtipps fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'Interamt')
      ? fetchInteramt(config).catch((err) => {
          console.error(`[Warnung] Interamt fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'BundService')
      ? fetchBundService().catch((err) => {
          console.error(`[Warnung] BundService fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'BMWK')
      ? fetchSourceByUrls('BMWK', ['https://www.bundeswirtschaftsministerium.de/Navigation/DE/Ministerium/Stellenangebote/stellenangebote.html']).catch((err) => {
          console.error(`[Warnung] BMWK fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'BMG')
      ? fetchSourceByUrls('BMG', ['https://www.bundesgesundheitsministerium.de/ministerium/karriere/stellenangebote']).catch((err) => {
          console.error(`[Warnung] BMG fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'BMI')
      ? fetchSourceByUrls('BMI', ['https://www.bmi.bund.de/DE/service/stellenangebote/stellenangebote-node.html']).catch((err) => {
          console.error(`[Warnung] BMI fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'BMBFSFJ')
      ? fetchSourceByUrls('BMBFSFJ', ['https://www.bmbfsfj.bund.de/bmbfsfj/ministerium/bmbfsfj-als-arbeitgeber/ausschreibungen']).catch((err) => {
          console.error(`[Warnung] BMBFSFJ fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'BMDS')
      ? fetchSourceByUrls('BMDS', ['https://bmds.bund.de/ministerium/bmds-als-arbeitgeber']).catch((err) => {
          console.error(`[Warnung] BMDS fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'BMF')
      ? fetchSourceByUrls('BMF', ['https://www.bundesfinanzministerium.de/Web/DE/Ministerium/Arbeiten-Ausbildung/Stellenangebote/stellenangebote.html']).catch((err) => {
          console.error(`[Warnung] BMF fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'StepStone')
      ? fetchStepstone(config).catch((err) => {
          console.error(`[Warnung] StepStone fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'StudySmarter')
      ? fetchStudySmarter(config).catch((err) => {
          console.error(`[Warnung] StudySmarter fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'KarriereportalBerlin')
      ? fetchKarriereportalBerlinJobs().catch((err) => {
          console.error(`[Warnung] KarriereportalBerlin fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'Arbeitsagentur')
      ? fetchSourceByUrls('Arbeitsagentur', ['https://www.arbeitsagentur.de/jobsuche/suche?angebotsart=1&wo=Berlin']).catch((err) => {
          console.error(`[Warnung] Arbeitsagentur fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'LinkedInJobs')
      ? fetchSourceByUrls('LinkedInJobs', ['https://de.linkedin.com/jobs/search/?keywords=Public%20Affairs&location=Berlin']).catch((err) => {
          console.error(`[Warnung] LinkedInJobs fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    sourceEnabled(config, 'GoodJobs')
      ? fetchSourceByUrls('GoodJobs', ['https://goodjobs.eu/jobs']).catch((err) => {
          console.error(`[Warnung] GoodJobs fehlgeschlagen: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
  ]);

  const gJobsEnriched = await enrichGesinesJobs(gJobs);
  const sJobsEnriched = await enrichStepstoneJobs(sJobs);
  const allJobs = dedupeJobs([...aJobs, ...rJobs, ...gJobsEnriched, ...iJobs, ...bJobs, ...bmwkJobs, ...bmgJobs, ...bmiJobs, ...bmbfsfjJobs, ...bmdsJobs, ...bmfJobs, ...sJobsEnriched, ...ssJobs, ...kpbJobs, ...baJobs, ...liJobs, ...goodJobs]);
  const freshJobs = filterByAge(allJobs, config.lookbackDays);
  const sourceFiltered = freshJobs.filter((j) => sourceEnabled(config, j.source));
  const locationFiltered = sourceFiltered.filter((j) => matchesStrictLocations(j, config.strictLocations));
  const excludeFiltered = locationFiltered.filter((j) => !containsExcluded(j, config));
  const nonNoiseFiltered = excludeFiltered.filter((j) => !isObviousNonJob(j));
  const remoteFiltered = filterRemote(nonNoiseFiltered, config.remoteOnly);

  const scoredSorted = remoteFiltered
    .map((job) => scoreJob(job, config))
    .sort((a, b) => b.score - a.score);
  const scoredQualified = scoredSorted.filter((job) => job.score >= config.minimumScore);
  const cappedQualified = applySourceCaps(scoredQualified, Number(config.maxResults || 45));
  const ranked = fillSourceQuotas(scoredSorted, cappedQualified, Number(config.maxResults || 45));

  console.log(`Quellen: Arbeitnow=${aJobs.length}, Remotive=${rJobs.length}, GesinesJobtipps=${gJobsEnriched.length}, Interamt=${iJobs.length}, BundService=${bJobs.length}, BMWK=${bmwkJobs.length}, BMG=${bmgJobs.length}, BMI=${bmiJobs.length}, BMBFSFJ=${bmbfsfjJobs.length}, BMDS=${bmdsJobs.length}, BMF=${bmfJobs.length}, StepStone=${sJobsEnriched.length}, StudySmarter=${ssJobs.length}, KarriereportalBerlin=${kpbJobs.length}, Arbeitsagentur=${baJobs.length}, LinkedInJobs=${liJobs.length}, GoodJobs=${goodJobs.length}`);
  console.log(`Gesamt: ${allJobs.length}, aktuell: ${freshJobs.length}, geo/source: ${remoteFiltered.length}, Treffer: ${ranked.length}`);

  ranked.forEach((job, idx) => {
    console.log(`${idx + 1}. [${job.score}] ${job.title} @ ${job.company} (${job.location || 'n/a'})`);
    console.log(`   ${job.url}`);
  });

  if (args.out) {
    const md = toMarkdown(ranked, configPath);
    await fs.writeFile(path.resolve(args.out), md, 'utf8');
    console.log(`Markdown geschrieben: ${path.resolve(args.out)}`);
  }

  if (args.json) {
    await fs.writeFile(path.resolve(args.json), JSON.stringify(ranked, null, 2), 'utf8');
    console.log(`JSON geschrieben: ${path.resolve(args.json)}`);
  }
}

main().catch((err) => {
  console.error(`Fehler: ${err.message}`);
  process.exit(1);
});
