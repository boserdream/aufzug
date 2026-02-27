const liftGrid = document.getElementById("liftGrid");
const globalMessage = document.getElementById("globalMessage");
const lastCheckInfo = document.getElementById("lastCheckInfo");
const addLiftForm = document.getElementById("addLiftForm");
const checkNowBtn = document.getElementById("checkNowBtn");
const intervalInput = document.getElementById("intervalMinutes");
const saveIntervalBtn = document.getElementById("saveIntervalBtn");

function setMessage(text) {
  globalMessage.textContent = text || "";
}

function formatDateTime(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(date);
}

function badgeClass(status) {
  return "badge";
}

function badgeLabel(status) {
  if (status === "working") return "OK";
  if (status === "broken") return "Defekt";
  if (status === "error") return "Fehler";
  return "Unklar";
}

function miniStatusSymbol(status) {
  if (status === "working") return "✓";
  if (status === "broken") return "✕";
  if (status === "error") return "!";
  return "?";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function render(data) {
  const config = data?.config || { lifts: [], poll_interval_seconds: 300 };
  const state = data?.state || { lifts: {} };
  const lifts = config.lifts || [];

  intervalInput.value = String(Math.round((config.poll_interval_seconds || 300) / 60));
  lastCheckInfo.textContent = `Letzte Prüfung: ${formatDateTime(state.last_check_finished_at)}`;

  if (!lifts.length) {
    liftGrid.innerHTML = "<p>Noch keine Aufzüge eingetragen.</p>";
    return;
  }

  liftGrid.innerHTML = lifts
    .map((lift) => {
      const entry = state.lifts?.[lift.id] || {
        status: "unknown",
        details: "Noch nicht geprüft.",
        sub_lifts: [],
        checked_at: null
      };
      const subLifts = Array.isArray(entry.sub_lifts) ? entry.sub_lifts : [];
      const subLiftHtml = subLifts.length
        ? `<div class="mini-lifts" aria-label="Aufzüge am Bahnhof">
            ${subLifts
              .map(
                (subLift) => `
              <span
                class="mini-lift"
                title="Aufzug ${escapeHtml(subLift.index)}: ${escapeHtml(badgeLabel(subLift.status))}"
              >
                <span class="mini-symbol">${miniStatusSymbol(subLift.status)}</span>
                <span class="mini-index">${escapeHtml(subLift.index)}</span>
              </span>
            `
              )
              .join("")}
          </div>`
        : "";
      return `
        <article class="lift-card">
          <div class="lift-header">
            <h3 class="lift-name">${escapeHtml(lift.name)}</h3>
            <span class="${badgeClass(entry.status)}">${badgeLabel(entry.status)}</span>
          </div>
          <p class="details">${escapeHtml(entry.details || "-")}</p>
          ${subLiftHtml}
          <p class="url"><a href="${escapeHtml(lift.url)}" target="_blank" rel="noreferrer">Zur Quelle</a></p>
          <p class="checked">Geprüft: ${formatDateTime(entry.checked_at)}</p>
          ${
            entry.error
              ? `<p class="checked">Fehler: ${escapeHtml(entry.error)}</p>`
              : ""
          }
          <div class="card-actions">
            <button class="btn btn-delete" data-remove-id="${escapeHtml(lift.id)}" type="button">Entfernen</button>
          </div>
        </article>
      `;
    })
    .join("");
}

async function refresh() {
  const data = await window.liftMonitor.getState();
  render(data);
}

addLiftForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(addLiftForm);
  const name = String(form.get("liftName") || "").trim();
  const url = String(form.get("liftUrl") || "").trim();
  const result = await window.liftMonitor.addLift({ name, url });
  if (!result.ok) {
    setMessage(result.error || "Aufzug konnte nicht hinzugefügt werden.");
    return;
  }
  addLiftForm.reset();
  setMessage("Aufzug hinzugefügt.");
  await refresh();
});

checkNowBtn.addEventListener("click", async () => {
  setMessage("Prüfung läuft ...");
  await window.liftMonitor.checkNow();
  setMessage("Prüfung abgeschlossen.");
  await refresh();
});

saveIntervalBtn.addEventListener("click", async () => {
  const minutes = Number(intervalInput.value);
  const result = await window.liftMonitor.setIntervalMinutes(minutes);
  if (!result.ok) {
    setMessage(result.error || "Intervall konnte nicht gespeichert werden.");
    return;
  }
  setMessage(`Intervall gespeichert: ${minutes} Minute(n).`);
  await refresh();
});

liftGrid.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-remove-id]");
  if (!button) return;
  const id = button.getAttribute("data-remove-id");
  if (!id) return;
  await window.liftMonitor.removeLift(id);
  setMessage("Aufzug entfernt.");
  await refresh();
});

window.liftMonitor.onUpdate((data) => {
  render(data);
});

refresh().catch((error) => {
  setMessage(`Fehler beim Laden: ${String(error?.message || error)}`);
});
