const statusEl = document.getElementById("status");
const statsEl = document.getElementById("stats");
const sourceColumnsEl = document.getElementById("sourceColumns");
const lastUpdatedEl = document.getElementById("lastUpdated");
const reloadBtn = document.getElementById("reload");

const SOURCE_ORDER = [
  "StepStone",
  "GesinesJobtipps",
  "Interamt",
  "KarriereportalBerlin",
  "Arbeitsagentur",
  "GoodJobs",
];

const SOURCE_LABELS = {
  StepStone: "StepStone",
  GesinesJobtipps: "Gesine",
  Interamt: "Interamt",
  KarriereportalBerlin: "Karriereportal Berlin",
  Arbeitsagentur: "Arbeitsagentur",
  GoodJobs: "GoodJobs",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanText(value) {
  const raw = String(value ?? "");
  let txt = raw
    .replace(/\.res-[a-z0-9-]+\{[^}]*\}/gi, " ")
    .replace(/@media\s+screen\s+and\s+\(min-width:[^)]+\)\{[^}]*\}/gi, " ")
    .replace(/var\s+[a-zA-Z_$][\w$]*\s*=\s*document\.[^;]+;/g, " ")
    .replace(/document\.addEventListener\([^)]*\);?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!txt) return "";
  if (txt.length > 210) txt = `${txt.slice(0, 207).trimEnd()}...`;
  return txt;
}

function normalizeLocation(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const obj = JSON.parse(trimmed);
        const locality = obj?.address?.addressLocality;
        const street = obj?.address?.streetAddress;
        if (locality && street) return `${street}, ${locality}`;
        if (locality) return locality;
      } catch {
        // ignore parse errors
      }
    }
    return cleanText(trimmed);
  }
  if (value && typeof value === "object") {
    const locality = value?.address?.addressLocality;
    const street = value?.address?.streetAddress;
    if (locality && street) return `${street}, ${locality}`;
    if (locality) return locality;
  }
  return "";
}

function fmtAge(job) {
  if (typeof job.ageDays === "number" && job.ageDays >= 0 && job.ageDays !== 9999) {
    return `vor ${job.ageDays} Tagen`;
  }
  return "unbekannt";
}

function bySource(jobs) {
  const map = new Map();
  for (const job of jobs) {
    const key = String(job.source || "Andere");
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(job);
  }
  return map;
}

function renderStats(jobs) {
  const sourceCount = new Set(jobs.map((j) => j.source)).size;
  const avgScore = jobs.length
    ? (jobs.reduce((acc, j) => acc + (Number(j.score) || 0), 0) / jobs.length).toFixed(1)
    : "0.0";

  const statCards = [
    { label: "Treffer gesamt", value: jobs.length },
    { label: "Quellen aktiv", value: sourceCount },
    { label: "Ø Score", value: avgScore },
  ];

  statsEl.innerHTML = statCards
    .map(
      (s) => `
        <article class="stat-card">
          <p class="stat-label">${s.label}</p>
          <p class="stat-value">${s.value}</p>
        </article>
      `
    )
    .join("");
}

function renderColumns(jobs) {
  const grouped = bySource(jobs);
  const others = [...grouped.keys()].filter((k) => !SOURCE_ORDER.includes(k));
  const order = [...SOURCE_ORDER, ...others];

  sourceColumnsEl.innerHTML = order
    .map((source) => {
      const label = SOURCE_LABELS[source] || source;
      const list = (grouped.get(source) || []).slice(0, source === "StepStone" ? 10 : source === "GesinesJobtipps" ? 10 : 5);
      const cards = list.length
        ? list
            .map(
              (job) => `
                <article class="job-card">
                  <h3>${escapeHtml(cleanText(job.title) || "Ohne Titel")}</h3>
                  <p class="job-meta">
                    <span><strong>Arbeitgeber:</strong> ${escapeHtml(cleanText(job.company) || "unbekannt")}</span>
                    <span><strong>Ort:</strong> ${escapeHtml(normalizeLocation(job.location) || "unbekannt")}</span>
                    <span><strong>Veröffentlicht:</strong> ${escapeHtml(fmtAge(job))}</span>
                    <span><strong>Score:</strong> ${Number(job.score) || 0}</span>
                  </p>
                  <a class="job-link" href="${escapeHtml(job.url || "#")}" target="_blank" rel="noopener noreferrer">Zur Stelle</a>
                </article>
              `
            )
            .join("")
        : `<p class="empty">Keine Treffer.</p>`;

      return `
        <section class="source-panel" data-source="${source}">
          <header class="source-panel__head">${label}</header>
          <div class="source-panel__body">${cards}</div>
        </section>
      `;
    })
    .join("");
}

async function fetchJobs() {
  const candidates = ["./jobs/latest.json", "/tmp/jobfinder_daily_jobs.json"];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) return data;
    } catch {
      // try next candidate
    }
  }
  return [];
}

async function loadDashboard() {
  statusEl.textContent = "Lade Stellenanzeigen ...";
  const jobs = await fetchJobs();
  if (!jobs.length) {
    statusEl.textContent =
      "Keine Daten gefunden. Starte zuerst den Job-Lauf mit „Job Update Mail.app“ oder `Job-Update-Mail.command`.";
    statsEl.innerHTML = "";
    sourceColumnsEl.innerHTML = "";
    return;
  }

  renderStats(jobs);
  renderColumns(jobs);
  statusEl.textContent = "Daten geladen.";
  lastUpdatedEl.textContent = `Letztes Update: ${new Date().toLocaleString("de-DE")}`;
}

reloadBtn.addEventListener("click", () => loadDashboard());
void loadDashboard();
