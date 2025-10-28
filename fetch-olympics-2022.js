// fetch-olympics-2022.js
// Node 20+ required. Fetches ALL medals for W2022 and writes two JSON files.

import fs from "node:fs/promises";

const API = "https://olympics.com/en/api/v1/medals?game=W2022";

// --- helpers ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "FantasyOlympics/1.0 (+https://github.com/jakesports465)",
          "Accept": "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      const backoff = 600 * Math.pow(2, i);
      console.warn(`Fetch attempt ${i + 1} failed: ${err.message}. Retrying in ${backoff}ms…`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

// Normalize helpers (lightweight, tweak if you want)
function normDiscipline(d) {
  if (!d) return null;
  const map = new Map([
    ["Ice Hockey", "Hockey"],
    ["Short Track Speed Skating", "Short Track Speed Skating"],
    ["Cross-Country Skiing", "Cross-Country Skiing"],
    ["Alpine Skiing", "Alpine Skiing"],
    ["Nordic Combined", "Nordic Combined"],
    ["Ski Jumping", "Ski Jumping"],
    ["Freestyle Skiing", "Freestyle Skiing"],
    ["Figure Skating", "Figure Skating"],
    ["Speed Skating", "Speed Skating"],
    ["Skeleton", "Skeleton"],
    ["Bobsleigh", "Bobsleigh"],
    ["Luge", "Luge"],
    ["Biathlon", "Biathlon"],
    ["Curling", "Curling"],
    ["Snowboard", "Snowboard"],
  ]);
  return map.get(d.trim()) || d.trim();
}
const noc = (x) => (x || "").trim().toUpperCase();
function medalLetter(x) {
  const s = (x || "").toLowerCase();
  if (s.includes("gold")) return "G";
  if (s.includes("silver")) return "S";
  if (s.includes("bronze")) return "B";
  return null;
}
function toISO(x) {
  try {
    if (!x) return new Date().toISOString();
    if (typeof x === "number") return new Date(x).toISOString();
    return new Date(x).toISOString();
  } catch { return new Date().toISOString(); }
}

// Transform olympics.com payload into your rows
function transform(raw) {
  const list = Array.isArray(raw?.data) ? raw.data : (Array.isArray(raw) ? raw : []);
  const rows = [];
  let idx = 0;

  for (const item of list) {
    const discRaw =
      item?.discipline?.name ?? item?.discipline ?? item?.event?.discipline?.name ?? item?.sport;
    const countryRaw =
      item?.team?.code ?? item?.noc?.code ?? item?.countryCode ?? item?.country?.code ?? item?.noc ?? item?.country;
    const medalRaw = item?.medal?.name ?? item?.medal ?? item?.rank ?? item?.award;
    const timeRaw  = item?.date ?? item?.time ?? item?.awardedAt ?? item?.updatedAt ?? item?.lastUpdate;

    const discipline = normDiscipline(discRaw);
    const country = noc(countryRaw);
    const medal = medalLetter(medalRaw);
    const ts = toISO(timeRaw);

    if (!discipline || !country || !medal) continue;

    const slug = discipline.replace(/\s+/g, "-");
    const tnum = Date.parse(ts) || 0;
    const event_id = `W2022-${slug}-${country}-${medal}-${tnum || idx}`;
    rows.push({ discipline, country, medal, ts, event_id });
    idx++;
  }

  // de-dupe by event_id
  const seen = new Set();
  return rows.filter(r => (seen.has(r.event_id) ? false : (seen.add(r.event_id), true)));
}

// --- main ---
(async () => {
  try {
    console.log("Fetching medals:", API);
    const raw = await fetchWithRetry(API);

    await fs.writeFile("raw_w2022_medals.json", JSON.stringify(raw, null, 2));
    console.log("Saved raw_w2022_medals.json");

    const rows = transform(raw);
    console.log(`Normalized ${rows.length} medal rows`);

    await fs.writeFile("results_w2022_normalized.json", JSON.stringify(rows, null, 2));
    console.log("Saved results_w2022_normalized.json ✅");
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
})();
