// scrape-w2022-from-page.js
// Node 20+. Scrapes olympics.com Beijing 2022 pages and extracts medal rows.
// Writes results_w2022_normalized.json for your app.

import fs from "node:fs/promises";

const PAGES = [
  "https://www.olympics.com/en/olympic-games/beijing-2022/medals",
  "https://www.olympics.com/en/olympic-games/beijing-2022/results"
];

// --- tiny utils ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function get(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "FantasyOlympics-Scraper/1.0 (+github)",
          "Accept": "text/html,application/xhtml+xml,application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      const backoff = 600 * Math.pow(2, i);
      console.warn(`[get] ${url} failed (${e.message}). retry in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

// grab all JSON blobs we can find on an olympics.com page
function extractJsonBlobs(html) {
  const blobs = [];

  // 1) Next.js __NEXT_DATA__ pattern
  const nextDataRe = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i;
  const nextMatch = html.match(nextDataRe);
  if (nextMatch) {
    try { blobs.push(JSON.parse(nextMatch[1])); } catch {}
  }

  // 2) Any JSON-LD blocks
  const jsonLdRe = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = jsonLdRe.exec(html))) {
    try { blobs.push(JSON.parse(m[1])); } catch {}
  }

  // 3) Any inline script that looks like JSON (very defensive)
  const looseRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = looseRe.exec(html))) {
    const body = (m[1] || "").trim();
    // quick heuristic: big curly content
    if (body.startsWith("{") && body.endsWith("}")) {
      try { blobs.push(JSON.parse(body)); } catch {}
    }
    if (body.startsWith("[") && body.endsWith("]")) {
      try { blobs.push(JSON.parse(body)); } catch {}
    }
  }

  return blobs;
}

// walk any object/array & collect items that look like medal entries
function collectMedalRows(root) {
  const rows = [];

  function walk(node) {
    if (!node || typeof node !== "object") return;

    // Heuristic detection: objects that have medal & country/NOC & discipline/sport
    if (!Array.isArray(node)) {
      const keys = Object.keys(node);
      const hasMedal = keys.some(k => /medal|rank|award/i.test(k));
      const hasCountry =
        keys.some(k => /noc|country.?code|team.?code|country/i.test(k));
      const hasDiscipline =
        keys.some(k => /discipline|sport/i.test(k));

      if (hasMedal && hasCountry && hasDiscipline) {
        const discRaw =
          node.discipline?.name ?? node.discipline ?? node.event?.discipline?.name ?? node.sport;
        const countryRaw =
          node.team?.code ?? node.noc?.code ?? node.countryCode ?? node.country?.code ?? node.noc ?? node.country;
        const medalRaw =
          node.medal?.name ?? node.medal ?? node.rank ?? node.award;
        const timeRaw =
          node.date ?? node.time ?? node.awardedAt ?? node.updatedAt ?? node.lastUpdate ?? node.timestamp;

        const discipline = normDiscipline(discRaw);
        const country = noc(countryRaw);
        const medal = medalLetter(medalRaw);
        const ts = toISO(timeRaw);

        if (discipline && country && medal) {
          const slug = discipline.replace(/\s+/g, "-");
          const tnum = Date.parse(ts) || Date.now();
          const event_id = `W2022-${slug}-${country}-${medal}-${tnum}`;
          rows.push({ discipline, country, medal, ts, event_id });
        }
      }
    }

    // Recurse
    if (Array.isArray(node)) {
      for (const it of node) walk(it);
    } else {
      for (const k of Object.keys(node)) walk(node[k]);
    }
  }

  walk(root);
  return dedupe(rows);
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter(r => (seen.has(r.event_id) ? false : (seen.add(r.event_id), true)));
}

// normalizers
function normDiscipline(d) {
  if (!d) return null;
  const s = String(d).trim();
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
  return map.get(s) || s;
}
const noc = (x) => (x || "").trim().toUpperCase();
function medalLetter(x) {
  const s = (x || "").toString().toLowerCase();
  if (s.includes("gold")) return "G";
  if (s.includes("silver")) return "S";
  if (s.includes("bronze")) return "B";
  // sometimes use 1/2/3 or g/s/b codes
  if (s === "g") return "G";
  if (s === "s") return "S";
  if (s === "b") return "B";
  if (s === "1") return "G";
  if (s === "2") return "S";
  if (s === "3") return "B";
  return null;
}
function toISO(x) {
  try {
    if (!x) return new Date().toISOString();
    if (typeof x === "number") return new Date(x).toISOString();
    return new Date(x).toISOString();
  } catch { return new Date().toISOString(); }
}

// --- main ---
(async () => {
  const allRows = [];
  for (const url of PAGES) {
    try {
      console.log("Fetching", url);
      const html = await get(url);
      const blobs = extractJsonBlobs(html);
      console.log(`  found ${blobs.length} JSON blobs`);
      for (const b of blobs) {
        const rows = collectMedalRows(b);
        if (rows.length) {
          console.log(`  +${rows.length} medal rows from one blob`);
          allRows.push(...rows);
        }
      }
    } catch (e) {
      console.warn("Failed page:", url, e.message);
    }
  }

  // de-dupe again
  const finalRows = dedupe(allRows);

  console.log(`Total medal rows: ${finalRows.length}`);
  await fs.writeFile("results_w2022_normalized.json", JSON.stringify(finalRows, null, 2));
  console.log("Saved results_w2022_normalized.json ✅");
})();
