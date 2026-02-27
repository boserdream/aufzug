import { app, BrowserWindow, Notification, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.resolve(__dirname, "../tools/lift_monitor/config.json");
const EXAMPLE_CONFIG_PATH = path.resolve(__dirname, "../tools/lift_monitor/config.example.json");
const STATE_PATH = path.resolve(__dirname, "../tools/lift_monitor/state.json");

const BROKEN_MARKER = "Außer Betrieb";
const WORKING_MARKER = "Der Aufzug steht zur Verfügung.";
const UNKNOWN_MARKER = "Aktuell liegen keine Informationen vor.";
const REPAIR_MARKER = "wird so schnell wie möglich repariert";
const SOON_MARKER = "fährt in Kürze wieder";
const FORECAST_MARKER = "fährt voraussichtlich ab";

let mainWindow = null;
let pollTimer = null;
let state = { lifts: {}, last_check_started_at: null, last_check_finished_at: null };
const APP_ICON_PATH = path.join(__dirname, "assets", "icon.png");

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "lift";
}

function readJson(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  const parent = path.dirname(filePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function ensureConfig() {
  if (!existsSync(CONFIG_PATH) && existsSync(EXAMPLE_CONFIG_PATH)) {
    const example = readJson(EXAMPLE_CONFIG_PATH, { poll_interval_seconds: 300, lifts: [] });
    writeJson(CONFIG_PATH, example);
  }
}

function getConfig() {
  ensureConfig();
  return readJson(CONFIG_PATH, {
    poll_interval_seconds: 300,
    notify_on_first_run: false,
    whatsapp: { enabled: false, provider: "callmebot", phone: "", apikey: "" },
    lifts: []
  });
}

function saveConfig(nextConfig) {
  writeJson(CONFIG_PATH, nextConfig);
}

function getPublicState() {
  const config = getConfig();
  return {
    config,
    state
  };
}

function htmlToText(rawHtml) {
  return rawHtml
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimToCurrentSection(rawHtml) {
  const startCandidates = ["Aktueller Status", "Status des Aufzugs", "Aufzug zwischen"];
  let start = 0;
  for (const marker of startCandidates) {
    const idx = rawHtml.indexOf(marker);
    if (idx !== -1) {
      start = idx;
      break;
    }
  }
  const endCandidates = ["Meldungshistorie", "Letzte Meldungen", "Historie", "Verlauf"];
  let end = rawHtml.length;
  for (const marker of endCandidates) {
    const idx = rawHtml.indexOf(marker, start);
    if (idx !== -1) {
      end = Math.min(end, idx);
    }
  }
  return rawHtml.slice(start, end);
}

function normalizeStationUrl(input) {
  try {
    const parsed = new URL(input);
    const stationMatch = parsed.pathname.match(/^\/station\/(\d+)/);
    if (!stationMatch) return input;
    parsed.pathname = `/station/${stationMatch[1]}`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return input;
  }
}

function mapStatusPhraseToStatus(phrase) {
  if (
    phrase.includes(BROKEN_MARKER) ||
    phrase.includes(REPAIR_MARKER) ||
    phrase.includes(SOON_MARKER) ||
    phrase.includes(FORECAST_MARKER)
  ) {
    return "broken";
  }
  if (phrase.includes(WORKING_MARKER)) return "working";
  if (phrase.includes(UNKNOWN_MARKER)) return "unknown";
  return "unknown";
}

function stripHtmlTags(input) {
  return String(input || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseStationSlides(rawHtml, stationUrl) {
  const slideRegex =
    /<li\b([^>]*)>\s*<section class="slider-head">[\s\S]*?<section class="anlagen-description">([\s\S]*?)<\/section>[\s\S]*?<section class="anlagen-history">/g;

  const results = [];
  let match;
  while ((match = slideRegex.exec(rawHtml)) !== null) {
    const attrs = match[1] || "";
    const descriptionHtml = match[2] || "";
    const className = (attrs.match(/class="([^"]*)"/i)?.[1] || "").toLowerCase();
    const infoHtml = descriptionHtml.match(/<p\s+class="(?:broken-info|unbroken-info)">([\s\S]*?)<\/p>/i)?.[1] || "";
    const directionHtml = descriptionHtml.match(/<p>\s*(Aufzug zwischen[\s\S]*?)<\/p>/i)?.[1] || "";
    const infoText = stripHtmlTags(infoHtml);
    const directionText = stripHtmlTags(directionHtml);
    const statusFromInfo = mapStatusPhraseToStatus(infoText);
    const status = className.includes("broken")
      ? "broken"
      : statusFromInfo === "unknown" && className.includes("unbroken")
        ? "working"
        : statusFromInfo;

    results.push({
      index: results.length + 1,
      status,
      details: directionText ? `${infoText} (${directionText})` : infoText || "Unbekannter Status",
      url: stationUrl
    });
  }

  return results;
}

function parseLiftEntriesFromStationHtml(rawHtml, stationUrl) {
  const scopedText = htmlToText(trimToCurrentSection(rawHtml));
  const statusPhrasePattern =
    "(Außer Betrieb(?:\\s*\\([^)]*\\))?|Der Aufzug steht zur Verfügung\\.|Aktuell liegen keine Informationen vor\\.|Der Aufzug[^.]*?(?:wird so schnell wie möglich repariert|fährt in Kürze wieder|fährt voraussichtlich ab[^.]*wieder)\\.)";
  const entryRegex = new RegExp(
    `${statusPhrasePattern}\\s+Aufzug zwischen\\s+(.+?)\\s+Informationen zum Aufzug`,
    "g"
  );

  const results = [];
  const seenDirections = new Set();
  let match;
  while ((match = entryRegex.exec(scopedText)) !== null) {
    const phrase = (match[1] || "").trim();
    const direction = (match[2] || "").trim();
    const directionKey = direction.toLowerCase();
    if (directionKey && seenDirections.has(directionKey)) {
      continue;
    }
    if (directionKey) seenDirections.add(directionKey);
    results.push({
      index: results.length + 1,
      status: mapStatusPhraseToStatus(phrase),
      details: direction ? `${phrase} (${direction})` : phrase,
      url: stationUrl
    });
  }

  if (results.length > 0) return results;

  const fallbackPhraseRegex = new RegExp(statusPhrasePattern, "g");
  const fallbacks = [];
  let fallbackMatch;
  while ((fallbackMatch = fallbackPhraseRegex.exec(scopedText)) !== null) {
    const phrase = (fallbackMatch[1] || "").trim();
    fallbacks.push({
      index: fallbacks.length + 1,
      status: mapStatusPhraseToStatus(phrase),
      details: phrase,
      url: stationUrl
    });
  }
  return fallbacks.slice(0, 8);
}

function aggregateStationStatus(subLifts) {
  if (!subLifts.length) {
    return { status: "unknown", details: "Kein eindeutiger Status gefunden.", sub_lifts: [] };
  }

  const brokenCount = subLifts.filter((lift) => lift.status === "broken").length;
  const workingCount = subLifts.filter((lift) => lift.status === "working").length;
  const unknownCount = subLifts.filter((lift) => lift.status === "unknown").length;
  const total = subLifts.length;

  if (brokenCount > 0) {
    return {
      status: "broken",
      details: `${brokenCount} von ${total} Aufzügen defekt`,
      sub_lifts: subLifts
    };
  }

  if (workingCount === total) {
    return {
      status: "working",
      details: `Alle ${total} Aufzüge verfügbar`,
      sub_lifts: subLifts
    };
  }

  if (unknownCount === total) {
    return {
      status: "unknown",
      details: `Keine verlässlichen Informationen für ${total} Aufzüge`,
      sub_lifts: subLifts
    };
  }

  return {
    status: "unknown",
    details: `${workingCount} verfügbar, ${unknownCount} unklar`,
    sub_lifts: subLifts
  };
}

async function fetchLiftStatus(lift) {
  const normalizedInputUrl = normalizeStationUrl(lift.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(normalizedInputUrl, {
      signal: controller.signal,
      headers: {
        "user-agent": "LiftMonitorBerlin/1.0",
        "accept-language": "de-DE,de;q=0.9,en;q=0.8"
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const stationHtml = await response.text();
    const parsedFromSlides = parseStationSlides(stationHtml, normalizedInputUrl);
    const subLifts =
      parsedFromSlides.length > 0
        ? parsedFromSlides
        : parseLiftEntriesFromStationHtml(stationHtml, normalizedInputUrl);

    const deduped = [];
    const seen = new Set();
    for (const item of subLifts) {
      const dedupeKey = `${item.url}|${item.details}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      deduped.push({
        ...item,
        index: deduped.length + 1
      });
    }

    const finalSubLifts = deduped.length ? deduped : subLifts;
    return aggregateStationStatus(finalSubLifts);
  } finally {
    clearTimeout(timeout);
  }
}

function statusSymbol(status) {
  if (status === "working") return "✓";
  if (status === "broken") return "✕";
  if (status === "unknown") return "?";
  return "!";
}

function collectBinarySubLiftChanges(previousSubLifts, nextSubLifts) {
  const prevMap = new Map();
  for (const item of Array.isArray(previousSubLifts) ? previousSubLifts : []) {
    prevMap.set(Number(item.index), item.status);
  }

  const changes = [];
  for (const item of Array.isArray(nextSubLifts) ? nextSubLifts : []) {
    const idx = Number(item.index);
    const prev = prevMap.get(idx);
    const next = item.status;
    const isBinary = (value) => value === "working" || value === "broken";
    if (isBinary(prev) && isBinary(next) && prev !== next) {
      changes.push({ index: idx, from: prev, to: next });
    }
  }
  return changes.sort((a, b) => a.index - b.index);
}

function buildSubLiftChangeSummary(changes) {
  if (!changes.length) return "";
  return changes
    .map((change) => `Aufzug ${change.index}: ${statusSymbol(change.from)} -> ${statusSymbol(change.to)}`)
    .join("\n");
}

function buildChangeNotificationText(lift, status, details, subLiftChanges = []) {
  const prefix = status === "broken" ? "DEFEKT" : status === "working" ? "WIEDER OK" : "STATUS";
  const subLiftSummary = buildSubLiftChangeSummary(subLiftChanges);
  const changeBlock = subLiftSummary ? `\nÄnderungen:\n${subLiftSummary}` : "";
  return `Aufzugs-Monitor Berlin\n${prefix}: ${lift.name}\n${details}${changeBlock}\n${lift.url}`;
}

function notifyDesktopChange(lift, status, details, subLiftChanges = []) {
  if (!Notification.isSupported()) return;
  let title = `Aufzug-Status: ${lift.name}`;
  if (status === "broken") title = `Aufzug kaputt: ${lift.name}`;
  if (status === "working") title = `Aufzug wieder OK: ${lift.name}`;
  const subLiftSummary = buildSubLiftChangeSummary(subLiftChanges);
  const body = subLiftSummary ? `${details} | ${subLiftSummary}` : `${details} | ${lift.url}`;

  new Notification({
    title,
    body
  }).show();
}

async function notifyWhatsApp(config, lift, status, details, subLiftChanges = []) {
  const whatsapp = config?.whatsapp || {};
  if (!whatsapp.enabled) return;
  const provider = String(whatsapp.provider || "callmebot").toLowerCase();

  if (provider !== "callmebot") {
    throw new Error(`Unbekannter WhatsApp-Provider: ${provider}`);
  }

  const phone = String(whatsapp.phone || "").trim();
  const apikey = String(whatsapp.apikey || "").trim();
  if (!phone || !apikey) {
    throw new Error("WhatsApp aktiv, aber phone/apikey fehlen in config.json");
  }

  const text = buildChangeNotificationText(lift, status, details, subLiftChanges);
  const url = new URL("https://api.callmebot.com/whatsapp.php");
  url.searchParams.set("phone", phone);
  url.searchParams.set("text", text);
  url.searchParams.set("apikey", apikey);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "user-agent": "LiftMonitorBerlin/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`WhatsApp-API Fehler: HTTP ${response.status}`);
  }
}

async function notifyChange(config, lift, status, details, subLiftChanges = []) {
  notifyDesktopChange(lift, status, details, subLiftChanges);
  try {
    await notifyWhatsApp(config, lift, status, details, subLiftChanges);
  } catch (error) {
    console.error("[WARN] WhatsApp-Benachrichtigung fehlgeschlagen:", error?.message || error);
  }
}

function broadcastState() {
  if (!mainWindow) return;
  mainWindow.webContents.send("lift-monitor:update", getPublicState());
}

async function checkAllLifts() {
  const config = getConfig();
  const notifyOnFirstRun = Boolean(config.notify_on_first_run);
  const startedAt = new Date().toISOString();
  state.last_check_started_at = startedAt;

  for (const lift of config.lifts) {
    const id = lift.id || slugify(lift.name);
    try {
      const result = await fetchLiftStatus(lift);
      const previous = state.lifts[id];
      const nextEntry = {
        id,
        name: lift.name,
        url: lift.url,
        status: result.status,
        details: result.details,
        sub_lifts: result.sub_lifts || [],
        error: null,
        checked_at: new Date().toISOString()
      };
      const changed = !previous || previous.status !== nextEntry.status;
      const subLiftChanges = previous
        ? collectBinarySubLiftChanges(previous.sub_lifts, nextEntry.sub_lifts)
        : [];
      const relevantChange = changed || subLiftChanges.length > 0;
      if (relevantChange && (notifyOnFirstRun || previous)) {
        await notifyChange(config, lift, nextEntry.status, nextEntry.details, subLiftChanges);
      }
      state.lifts[id] = nextEntry;
    } catch (error) {
      state.lifts[id] = {
        id,
        name: lift.name,
        url: lift.url,
        status: "error",
        details: "Prüfung fehlgeschlagen",
        sub_lifts: [],
        error: String(error?.message || error),
        checked_at: new Date().toISOString()
      };
    }
  }

  state.last_check_finished_at = new Date().toISOString();
  writeJson(STATE_PATH, state);
  broadcastState();
}

function restartPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const config = getConfig();
  const interval = Math.max(60, Number(config.poll_interval_seconds || 300));
  pollTimer = setInterval(() => {
    checkAllLifts().catch(() => {});
  }, interval * 1000);
}

function validateLiftInput(name, url) {
  if (!name || !name.trim()) return "Name fehlt.";
  if (!url || !url.trim()) return "URL fehlt.";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "Ungültige URL.";
  }
  if (!(parsed.hostname === "brokenlifts.org" || parsed.hostname === "www.brokenlifts.org")) {
    return "Bitte eine brokenlifts.org URL nutzen.";
  }
  if (!parsed.pathname.startsWith("/station/")) {
    return "Bitte eine Stations-URL nutzen (z. B. /station/900120008).";
  }
  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    autoHideMenuBar: true,
    title: "Aufzugs-Monitor Berlin",
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  state = readJson(STATE_PATH, state);
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(APP_ICON_PATH);
  }
  createWindow();
  restartPolling();
  await checkAllLifts();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      broadcastState();
    }
  });
});

ipcMain.handle("lift-monitor:get", async () => getPublicState());

ipcMain.handle("lift-monitor:add", async (_event, payload) => {
  const config = getConfig();
  const name = String(payload?.name || "").trim();
  const url = String(payload?.url || "").trim();
  const validation = validateLiftInput(name, url);
  if (validation) return { ok: false, error: validation };

  const id = slugify(name);
  if (config.lifts.some((lift) => lift.id === id || lift.url === url)) {
    return { ok: false, error: "Aufzug existiert bereits." };
  }

  config.lifts.push({ id, name, url });
  saveConfig(config);
  await checkAllLifts();
  restartPolling();
  return { ok: true };
});

ipcMain.handle("lift-monitor:remove", async (_event, id) => {
  const config = getConfig();
  config.lifts = config.lifts.filter((lift) => lift.id !== id);
  saveConfig(config);
  delete state.lifts[id];
  writeJson(STATE_PATH, state);
  restartPolling();
  broadcastState();
  return { ok: true };
});

ipcMain.handle("lift-monitor:check-now", async () => {
  await checkAllLifts();
  return { ok: true };
});

ipcMain.handle("lift-monitor:set-interval", async (_event, minutes) => {
  const parsed = Number(minutes);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return { ok: false, error: "Intervall muss mindestens 1 Minute sein." };
  }
  const config = getConfig();
  config.poll_interval_seconds = Math.round(parsed * 60);
  saveConfig(config);
  restartPolling();
  broadcastState();
  return { ok: true };
});

app.on("window-all-closed", () => {
  if (pollTimer) clearInterval(pollTimer);
  if (process.platform !== "darwin") {
    app.quit();
  }
});
