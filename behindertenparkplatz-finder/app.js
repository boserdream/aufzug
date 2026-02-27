const BERLIN_CENTER = { lat: 52.520008, lon: 13.404954 };
const BERLIN_MAX_DISTANCE_KM = 35;
const BERLIN_WFS_ENDPOINT = "https://gdi.berlin.de/services/wfs/behindertenparkplaetze";
const VBB_JOURNEY_ENDPOINT = "https://v6.vbb.transport.rest/journeys";
const VBB_NEARBY_ENDPOINT = "https://v6.vbb.transport.rest/locations/nearby";
const VBB_LOCATIONS_ENDPOINT = "https://v6.vbb.transport.rest/locations";
const BERLIN_BBOX = {
  west: 13.0884,
  south: 52.3383,
  east: 13.7612,
  north: 52.6755
};

const map = L.map("map").setView([BERLIN_CENTER.lat, BERLIN_CENTER.lon], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const form = document.getElementById("search-form");
const destinationInput = document.getElementById("destination");
const radiusSelect = document.getElementById("radius");
const statusEl = document.getElementById("status");
const bestResultEl = document.getElementById("best-result");
const alternativesEl = document.getElementById("alternatives");
const bestDistanceEl = document.getElementById("best-distance");
const bestLocationEl = document.getElementById("best-location");
const bestLinkEl = document.getElementById("best-link");
const alternativeListEl = document.getElementById("alternative-list");
const routeForm = document.getElementById("route-form");
const routeFromInput = document.getElementById("route-from");
const routeToInput = document.getElementById("route-to");
const routeViaInput = document.getElementById("route-via");
const routeStatusEl = document.getElementById("route-status");
const routeResultEl = document.getElementById("route-result");
const routeSummaryEl = document.getElementById("route-summary");
const routeIssuesEl = document.getElementById("route-issues");

let destinationMarker = null;
let parkingLayer = L.layerGroup().addTo(map);
let routeLayer = L.layerGroup().addTo(map);

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setRouteStatus(message, isError = false) {
  routeStatusEl.textContent = message;
  routeStatusEl.classList.toggle("error", isError);
}

function toRadians(value) {
  return value * (Math.PI / 180);
}

function distanceMeters(aLat, aLon, bLat, bLon) {
  const earthRadius = 6371000;
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);

  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 = Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(s1 + s2), Math.sqrt(1 - (s1 + s2)));

  return earthRadius * c;
}

function formatDistance(meters) {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(2).replace(".", ",")} km`;
}

function normalizeAddress(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    return "";
  }
  return /berlin/i.test(trimmed) ? trimmed : `${trimmed}, Berlin`;
}

async function geocodeInBerlin(query) {
  const normalized = normalizeAddress(query);
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", normalized);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "de");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error("Geocoding nicht erreichbar.");
  }

  const data = await response.json();
  if (!data.length) {
    return null;
  }

  const top = data[0];
  const lat = Number(top.lat);
  const lon = Number(top.lon);
  const distanceToCenter = distanceMeters(lat, lon, BERLIN_CENTER.lat, BERLIN_CENTER.lon) / 1000;
  if (distanceToCenter > BERLIN_MAX_DISTANCE_KM) {
    return null;
  }

  return {
    lat,
    lon,
    label: top.display_name
  };
}

async function fetchOsmDisabledParking(lat, lon, radiusMeters) {
  const overpassQuery = `
[out:json][timeout:60];
(
  nwr["amenity"="parking_space"]["parking_space"="disabled"](around:${radiusMeters},${lat},${lon});
  nwr["amenity"="parking_space"]["parking_space"="designated"](around:${radiusMeters},${lat},${lon});
  nwr["amenity"="parking_space"]["designation"="disabled"](around:${radiusMeters},${lat},${lon});
  nwr["amenity"="parking_space"]["access:disabled"="yes"](around:${radiusMeters},${lat},${lon});
  nwr["amenity"="parking_space"]["wheelchair"~"yes|designated"](around:${radiusMeters},${lat},${lon});
  nwr["amenity"="parking"]["disabled"="yes"](around:${radiusMeters},${lat},${lon});
  nwr["amenity"="parking"]["disabled"="designated"](around:${radiusMeters},${lat},${lon});
  nwr["amenity"="parking"]["capacity:disabled"](around:${radiusMeters},${lat},${lon});
  nwr["amenity"="parking"]["access:disabled"="yes"](around:${radiusMeters},${lat},${lon});
  nwr["amenity"="parking"]["wheelchair"~"yes|designated"](around:${radiusMeters},${lat},${lon});
);
out center tags;
  `.trim();

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    },
    body: new URLSearchParams({ data: overpassQuery })
  });

  if (!response.ok) {
    throw new Error("Parkplatzdaten konnten nicht geladen werden.");
  }

  const data = await response.json();
  const uniqueByLocation = new Map();
  (data.elements || [])
    .map((element) => {
      const eLat = element.lat ?? element.center?.lat;
      const eLon = element.lon ?? element.center?.lon;
      if (typeof eLat !== "number" || typeof eLon !== "number") {
        return null;
      }
      const tags = element.tags || {};
      return {
        id: `${element.type}-${element.id}`,
        lat: eLat,
        lon: eLon,
        name: tags.name || "Behindertenparkplatz",
        street: tags["addr:street"] || "",
        houseNumber: tags["addr:housenumber"] || "",
        disabledCapacity: tags["capacity:disabled"] || "",
        sourceType: element.type,
        source: "OpenStreetMap",
        distance: distanceMeters(lat, lon, eLat, eLon)
      };
    })
    .filter(Boolean)
    .forEach((parking) => {
      const key = `${parking.lat.toFixed(6)}:${parking.lon.toFixed(6)}`;
      const existing = uniqueByLocation.get(key);
      if (!existing || parking.distance < existing.distance) {
        uniqueByLocation.set(key, parking);
      }
    });

  return [...uniqueByLocation.values()].sort((a, b) => a.distance - b.distance);
}

function makeBBox(lat, lon, radiusMeters) {
  const latDelta = radiusMeters / 111320;
  const lonDelta = radiusMeters / (111320 * Math.cos(toRadians(lat)));
  return {
    south: lat - latDelta,
    west: lon - lonDelta,
    north: lat + latDelta,
    east: lon + lonDelta
  };
}

function createBerlinWfsUrlsForBbox(bbox) {
  const bboxValue = `${bbox.west},${bbox.south},${bbox.east},${bbox.north},EPSG:4326`;
  const candidates = [
    { version: "2.0.0", key: "typeNames", layer: "behindertenparkplaetze" },
    { version: "2.0.0", key: "typeNames", layer: "fis:behindertenparkplaetze" },
    { version: "1.1.0", key: "typeName", layer: "behindertenparkplaetze" },
    { version: "1.1.0", key: "typeName", layer: "fis:behindertenparkplaetze" }
  ];

  return candidates.map((candidate) => {
    const url = new URL(BERLIN_WFS_ENDPOINT);
    url.searchParams.set("service", "WFS");
    url.searchParams.set("request", "GetFeature");
    url.searchParams.set("version", candidate.version);
    url.searchParams.set(candidate.key, candidate.layer);
    url.searchParams.set("outputFormat", "application/json");
    url.searchParams.set("srsName", "EPSG:4326");
    url.searchParams.set("bbox", bboxValue);
    return url;
  });
}

function createBerlinWfsUrls(lat, lon, radiusMeters) {
  const bbox = makeBBox(lat, lon, radiusMeters);
  return createBerlinWfsUrlsForBbox(bbox);
}

function readProperty(properties, keys) {
  for (const key of keys) {
    if (properties[key] !== undefined && properties[key] !== null && properties[key] !== "") {
      return String(properties[key]);
    }
  }
  return "";
}

function parseBerlinFeature(feature, targetLat, targetLon) {
  if (!feature || feature.type !== "Feature") {
    return null;
  }

  const geometry = feature.geometry || {};
  const props = feature.properties || {};
  const point = geometry.type === "Point" ? geometry.coordinates : null;
  if (!point || point.length < 2) {
    return null;
  }

  const lon = Number(point[0]);
  const lat = Number(point[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const name = readProperty(props, ["name", "NAME", "bezeichnung", "BEZEICHNUNG"]) || "Behindertenparkplatz";
  const street = readProperty(props, ["strasse", "STRASSE", "str_name", "STR_NAME", "street"]);
  const houseNumber = readProperty(props, ["hausnr", "HAUSNR", "hausnummer", "HAUSNUMMER", "hnummer"]);
  const disabledCapacity = readProperty(props, ["anzahl", "ANZAHL", "capacity", "CAPACITY"]);

  return {
    id: String(
      readProperty(props, ["id", "ID", "objid", "OBJECTID", "gml_id", "fid"]) ||
      `berlin-${lat.toFixed(6)}-${lon.toFixed(6)}`
    ),
    lat,
    lon,
    name,
    street,
    houseNumber,
    disabledCapacity,
    sourceType: "feature",
    source: "Berlin Open Data",
    distance: distanceMeters(targetLat, targetLon, lat, lon)
  };
}

async function fetchBerlinOpenDataParking(lat, lon, radiusMeters) {
  const urls = createBerlinWfsUrls(lat, lon, radiusMeters);
  return fetchBerlinOpenDataParkingFromUrls(urls, lat, lon);
}

async function fetchBerlinOpenDataParkingCityWide(lat, lon) {
  const urls = createBerlinWfsUrlsForBbox(BERLIN_BBOX);
  return fetchBerlinOpenDataParkingFromUrls(urls, lat, lon);
}

async function fetchBerlinOpenDataParkingFromUrls(urls, lat, lon) {
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("json")) {
        continue;
      }

      const data = await response.json();
      const features = Array.isArray(data.features) ? data.features : [];
      const parsed = features
        .map((feature) => parseBerlinFeature(feature, lat, lon))
        .filter(Boolean)
        .sort((a, b) => a.distance - b.distance);

      if (parsed.length) {
        return parsed;
      }
    } catch (_error) {
      // Try next WFS variant.
    }
  }
  return [];
}

function mergeParkingLists(...lists) {
  const merged = new Map();
  lists.flat().forEach((parking) => {
    const key = `${parking.lat.toFixed(6)}:${parking.lon.toFixed(6)}`;
    const existing = merged.get(key);
    if (!existing || parking.distance < existing.distance) {
      merged.set(key, parking);
    } else if (existing.source !== parking.source) {
      existing.source = `${existing.source} + ${parking.source}`;
    }
  });
  return [...merged.values()].sort((a, b) => a.distance - b.distance);
}

function osmLink(lat, lon) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=19/${lat}/${lon}`;
}

function clearParkingMarkers() {
  parkingLayer.clearLayers();
}

function clearRouteMarkers() {
  routeLayer.clearLayers();
}

function normalizeStopId(rawId) {
  if (!rawId) {
    return "";
  }
  const text = String(rawId);
  const directDigits = text.match(/\d{6,}/);
  return directDigits ? directDigits[0] : text;
}

function buildBrokenLiftsUrl(stopId) {
  const normalized = normalizeStopId(stopId);
  if (!normalized || !/^\d{6,}$/.test(normalized)) {
    return "";
  }
  return `https://www.brokenlifts.org/station/${normalized}`;
}

function hasElevatorIssueText(text) {
  return /(aufzug|aufzueg|aufzugs|lift|elevator|rolltreppe|barrierefrei)/i.test(text || "");
}

function extractRemarkText(remark) {
  if (!remark) {
    return "";
  }
  if (typeof remark === "string") {
    return remark;
  }
  return [remark.summary, remark.text, remark.title, remark.message, remark.code]
    .filter(Boolean)
    .join(" | ");
}

function stopLikeToStation(stopLike) {
  if (!stopLike) {
    return null;
  }
  const stop = stopLike.stop || stopLike;
  const loc = stop.location || stopLike.location || {};
  const lat = Number(loc.latitude);
  const lon = Number(loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return {
    id: stop.id || stopLike.id || "",
    name: stop.name || stopLike.name || "Unbekannter Halt",
    lat,
    lon
  };
}

async function fetchVbbJourney(from, to) {
  const url = new URL(VBB_JOURNEY_ENDPOINT);
  url.searchParams.set("from", String(from.id));
  url.searchParams.set("to", String(to.id));
  url.searchParams.set("results", "1");
  url.searchParams.set("stopovers", "true");
  url.searchParams.set("remarks", "true");
  url.searchParams.set("language", "de");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error("VBB-Routenservice nicht erreichbar.");
  }

  const data = await response.json();
  if (data && data.message) {
    throw new Error(`VBB-Routenfehler: ${data.message}`);
  }
  if (!Array.isArray(data.journeys) || !data.journeys.length) {
    return null;
  }
  return data.journeys[0];
}

async function fetchNearestVbbStop(point) {
  const url = new URL(VBB_NEARBY_ENDPOINT);
  url.searchParams.set("latitude", String(point.lat));
  url.searchParams.set("longitude", String(point.lon));
  url.searchParams.set("stops", "true");
  url.searchParams.set("poi", "false");
  url.searchParams.set("addresses", "false");
  url.searchParams.set("results", "8");
  url.searchParams.set("distance", "1200");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error("VBB-Haltestellensuche nicht erreichbar.");
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("VBB-Haltestellensuche liefert kein erwartetes Format.");
  }

  const stop = data.find((entry) => entry?.type === "stop" && entry?.id);
  if (!stop) {
    return null;
  }

  return {
    id: String(stop.id),
    name: stop.name || "Unbekannte Haltestelle",
    lat: Number(stop.location?.latitude),
    lon: Number(stop.location?.longitude)
  };
}

async function fetchVbbStopByName(query) {
  const url = new URL(VBB_LOCATIONS_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("stops", "true");
  url.searchParams.set("poi", "false");
  url.searchParams.set("addresses", "false");
  url.searchParams.set("results", "8");
  url.searchParams.set("language", "de");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error("VBB-Haltestellen-Suche nicht erreichbar.");
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    return null;
  }

  const stop = data.find((entry) => entry?.type === "stop" && entry?.id);
  if (!stop) {
    return null;
  }

  return {
    id: String(stop.id),
    name: stop.name || query,
    lat: Number(stop.location?.latitude),
    lon: Number(stop.location?.longitude)
  };
}

async function resolveTextToStop(text) {
  const byName = await fetchVbbStopByName(text);
  if (byName) {
    return byName;
  }

  const point = await geocodeInBerlin(text);
  if (!point) {
    return null;
  }
  return fetchNearestVbbStop(point);
}

function parseViaEntries(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildCombinedRouteAnalysis(stops, journeyAnalyses) {
  const stationMap = new Map();
  const issueMap = new Map();

  const keyOf = (station) => station?.id || `${station?.name}|${station?.lat}|${station?.lon}`;
  const addStation = (station) => {
    if (!station) {
      return;
    }
    const key = keyOf(station);
    if (!stationMap.has(key)) {
      stationMap.set(key, station);
    }
  };

  stops.forEach(addStation);
  journeyAnalyses.forEach((analysis) => {
    analysis.stations.forEach(addStation);
    analysis.issues.forEach((issue) => {
      if (!issue.station) {
        return;
      }
      const key = keyOf(issue.station);
      if (!issueMap.has(key)) {
        issueMap.set(key, []);
      }
      issueMap.get(key).push(issue.text);
    });
  });

  const stationStatus = [...stationMap.values()].map((station) => {
    const key = keyOf(station);
    const issueTexts = issueMap.get(key) || [];
    return {
      station,
      defective: issueTexts.length > 0,
      issueTexts
    };
  });

  return {
    stations: [...stationMap.values()],
    issues: journeyAnalyses.flatMap((entry) => entry.issues),
    stationStatus
  };
}

function analyzeJourneyElevators(journey) {
  const issues = [];
  const stations = new Map();
  const addStation = (station) => {
    if (!station) {
      return;
    }
    const key = `${station.name}|${station.lat.toFixed(6)}|${station.lon.toFixed(6)}`;
    if (!stations.has(key)) {
      stations.set(key, station);
    }
  };

  const legs = Array.isArray(journey?.legs) ? journey.legs : [];
  legs.forEach((leg) => {
    const fromStation = stopLikeToStation(leg.origin);
    const toStation = stopLikeToStation(leg.destination);
    addStation(fromStation);
    addStation(toStation);

    (leg.stopovers || []).forEach((stopover) => {
      const station = stopLikeToStation(stopover.stop || stopover);
      addStation(station);
      (stopover.remarks || []).forEach((remark) => {
        const text = extractRemarkText(remark);
        if (hasElevatorIssueText(text)) {
          issues.push({
            station,
            text
          });
        }
      });
    });

    (leg.remarks || []).forEach((remark) => {
      const text = extractRemarkText(remark);
      if (hasElevatorIssueText(text)) {
        issues.push({
          station: fromStation || toStation,
          text
        });
      }
    });
  });

  (journey.remarks || []).forEach((remark) => {
    const text = extractRemarkText(remark);
    if (hasElevatorIssueText(text)) {
      issues.push({
        station: null,
        text
      });
    }
  });

  const stationList = [...stations.values()];
  const stationStatus = stationList.map((station) => {
    const stationIssues = issues.filter((issue) => issue.station?.name === station.name);
    return {
      station,
      defective: stationIssues.length > 0,
      issueTexts: stationIssues.map((entry) => entry.text)
    };
  });

  return {
    stations: stationList,
    issues,
    stationStatus
  };
}

function renderRouteResult(startPoint, endPoint, analysis) {
  clearRouteMarkers();
  routeIssuesEl.innerHTML = "";

  const startMarker = L.marker([startPoint.lat, startPoint.lon]).addTo(routeLayer);
  startMarker.bindPopup(`<strong>Start</strong><br>${startPoint.label}`);

  const endMarker = L.marker([endPoint.lat, endPoint.lon]).addTo(routeLayer);
  endMarker.bindPopup(`<strong>Ziel</strong><br>${endPoint.label}`);

  const warningMarkers = [];
  analysis.stationStatus.forEach((entry) => {
    const issue = entry.issueTexts[0] || "";
    const item = document.createElement("li");
    item.className = entry.defective ? "issue-warning" : "issue-ok";
    item.textContent = entry.defective
      ? `${entry.station.name}: Defekt/Störung gemeldet${issue ? ` (${issue})` : ""}`
      : `${entry.station.name}: Kein Störungshinweis (Live-Daten)`;

    const brokenLiftsUrl = buildBrokenLiftsUrl(entry.station?.id);
    if (brokenLiftsUrl) {
      const spacer = document.createTextNode(" ");
      const link = document.createElement("a");
      link.href = brokenLiftsUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "(BrokenLifts)";
      item.appendChild(spacer);
      item.appendChild(link);
    }
    routeIssuesEl.appendChild(item);

    const marker = L.circleMarker([entry.station.lat, entry.station.lon], {
      radius: entry.defective ? 7 : 6,
      color: entry.defective ? "#8f1d1d" : "#0a6a3f",
      fillColor: entry.defective ? "#dc2626" : "#22c55e",
      fillOpacity: 0.85,
      weight: 2
    }).addTo(routeLayer);
    marker.bindPopup(
      entry.defective
        ? `<strong>Aufzug-Störung</strong><br>${entry.station.name}<br>${issue}`
        : `<strong>Kein Störungshinweis</strong><br>${entry.station.name}`
    );
    warningMarkers.push([entry.station.lat, entry.station.lon]);
  });

  routeResultEl.classList.remove("hidden");
  const defectiveCount = analysis.stationStatus.filter((entry) => entry.defective).length;
  const okCount = analysis.stationStatus.length - defectiveCount;
  routeSummaryEl.textContent = `Geprüfte Halte/Aufzüge: ${analysis.stationStatus.length} | Defekt: ${defectiveCount} | Kein Störungshinweis: ${okCount}`;

  const bounds = [[startPoint.lat, startPoint.lon], [endPoint.lat, endPoint.lon], ...warningMarkers];
  map.fitBounds(bounds, { padding: [35, 35] });
}

function renderResults(destination, parkings) {
  clearParkingMarkers();
  alternativeListEl.innerHTML = "";

  const top = parkings[0];
  bestDistanceEl.textContent = `Entfernung zum Ziel: ${formatDistance(top.distance)}`;

  const addressLine = [top.street, top.houseNumber].filter(Boolean).join(" ");
  const capacityLine = top.disabledCapacity ? ` | Behindertenplätze: ${top.disabledCapacity}` : "";
  bestLocationEl.textContent = `${addressLine || "Adresse nicht hinterlegt"}${capacityLine} | Quelle: ${top.source}`;
  bestLinkEl.href = osmLink(top.lat, top.lon);

  bestResultEl.classList.remove("hidden");

  const markers = [];
  parkings.slice(0, 8).forEach((parking, index) => {
    const marker = L.circleMarker([parking.lat, parking.lon], {
      radius: index === 0 ? 10 : 7,
      color: index === 0 ? "#9a3412" : "#0a7c73",
      fillColor: index === 0 ? "#fb923c" : "#2dd4bf",
      fillOpacity: 0.85,
      weight: 2
    }).addTo(parkingLayer);

    marker.bindPopup(`
      <strong>${parking.name}</strong><br>
      Entfernung: ${formatDistance(parking.distance)}<br>
      Quelle: ${parking.source}<br>
      <a href="${osmLink(parking.lat, parking.lon)}" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>
    `);

    markers.push([parking.lat, parking.lon]);

    if (index > 0) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = osmLink(parking.lat, parking.lon);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `${formatDistance(parking.distance)} - ${parking.name} (${parking.source})`;
      item.appendChild(link);
      alternativeListEl.appendChild(item);
    }
  });

  if (parkings.length > 1) {
    alternativesEl.classList.remove("hidden");
  } else {
    alternativesEl.classList.add("hidden");
  }

  const bounds = [[destination.lat, destination.lon], ...markers];
  map.fitBounds(bounds, { padding: [35, 35] });
}

function renderDestinationMarker(destination) {
  if (destinationMarker) {
    map.removeLayer(destinationMarker);
  }

  destinationMarker = L.marker([destination.lat, destination.lon]).addTo(map);
  destinationMarker.bindPopup(`<strong>Ziel</strong><br>${destination.label}`).openPopup();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const destinationText = destinationInput.value.trim();
  const radius = Number(radiusSelect.value);

  if (!destinationText) {
    setStatus("Bitte eine Zieladresse eingeben.", true);
    return;
  }

  setStatus("Adresse wird gesucht...");
  bestResultEl.classList.add("hidden");
  alternativesEl.classList.add("hidden");
  clearParkingMarkers();

  try {
    const destination = await geocodeInBerlin(destinationText);
    if (!destination) {
      setStatus("Adresse nicht gefunden oder nicht in Berlin.", true);
      return;
    }

    renderDestinationMarker(destination);
    setStatus("Behindertenparkplätze werden gesucht (OSM + Berlin Open Data)...");

    const [osmResult, berlinResult] = await Promise.allSettled([
      fetchOsmDisabledParking(destination.lat, destination.lon, radius),
      fetchBerlinOpenDataParking(destination.lat, destination.lon, radius)
    ]);

    const osmParkings = osmResult.status === "fulfilled" ? osmResult.value : [];
    const berlinParkings = berlinResult.status === "fulfilled" ? berlinResult.value : [];
    let parkings = mergeParkingLists(osmParkings, berlinParkings);
    let usedCityWideFallback = false;

    // If local coverage is sparse, enrich with official city-wide Berlin dataset.
    if (parkings.length < 5) {
      const cityWideBerlin = await fetchBerlinOpenDataParkingCityWide(destination.lat, destination.lon);
      if (cityWideBerlin.length) {
        parkings = mergeParkingLists(parkings, cityWideBerlin);
        usedCityWideFallback = true;
      }
    }

    if (!parkings.length) {
      setStatus(`Keine Treffer im Radius von ${radius} m gefunden. Versuche 5.000 m.`, true);
      return;
    }

    renderResults(destination, parkings);
    const fallbackText = usedCityWideFallback ? " + berlinweiter Amtsdaten-Fallback" : "";
    setStatus(`Gefunden: ${parkings.length} Treffer (OSM: ${osmParkings.length}, Berlin Open Data lokal: ${berlinParkings.length}${fallbackText}). Nächstgelegener Parkplatz markiert.`);
  } catch (error) {
    console.error(error);
    setStatus("Fehler bei der Suche. Bitte später erneut versuchen.", true);
  }
});

routeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fromText = routeFromInput.value.trim();
  const toText = routeToInput.value.trim();
  const viaEntries = parseViaEntries(routeViaInput.value || "");

  if (!fromText || !toText) {
    setRouteStatus("Bitte Start und Ziel eingeben.", true);
    return;
  }

  setRouteStatus("Route wird gesucht...");
  routeResultEl.classList.add("hidden");
  clearRouteMarkers();

  try {
    const stopTexts = [fromText, ...viaEntries, toText];
    setRouteStatus("Haltestellen werden aufgelöst...");
    const stopResults = await Promise.all(stopTexts.map((text) => resolveTextToStop(text)));
    if (stopResults.some((stop) => !stop)) {
      setRouteStatus("Eine oder mehrere Stationen konnten nicht gefunden werden.", true);
      return;
    }
    const stops = stopResults;

    if (stops.length < 2) {
      setRouteStatus("Bitte mindestens Start und Ziel angeben.", true);
      return;
    }

    setRouteStatus("Route-Segmente werden auf Aufzugsstatus geprüft...");
    const segmentJourneys = [];
    for (let i = 0; i < stops.length - 1; i += 1) {
      const journey = await fetchVbbJourney(stops[i], stops[i + 1]);
      if (!journey) {
        setRouteStatus(`Keine Route für Segment "${stops[i].name} -> ${stops[i + 1].name}" gefunden.`, true);
        return;
      }
      segmentJourneys.push(journey);
    }

    const segmentAnalyses = segmentJourneys.map((journey) => analyzeJourneyElevators(journey));
    const analysis = buildCombinedRouteAnalysis(stops, segmentAnalyses);

    const startPoint = { lat: stops[0].lat, lon: stops[0].lon, label: stops[0].name };
    const endPoint = { lat: stops[stops.length - 1].lat, lon: stops[stops.length - 1].lon, label: stops[stops.length - 1].name };
    renderRouteResult(startPoint, endPoint, analysis);

    const defectiveCount = analysis.stationStatus.filter((entry) => entry.defective).length;
    if (defectiveCount) {
      setRouteStatus(`Es gibt ${defectiveCount} gemeldete Störung(en). Alle Stationen wurden aufgelistet.`, true);
    } else {
      setRouteStatus("Alle Halte deiner gewählten Strecke sind gelistet; aktuell kein Störungshinweis.");
    }
  } catch (error) {
    console.error(error);
    setRouteStatus("Fehler beim Abrufen der Route. Bitte später erneut versuchen.", true);
  }
});
