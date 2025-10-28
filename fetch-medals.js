// fetch-medals.js — Node 18+, ESM, GitHub Actions friendly
// Pulls medals from Olympics.com (W2022), normalizes, and upserts to Supabase.

import { createClient } from "@supabase/supabase-js";

// --- Your Supabase (hard-coded as requested) ---
const SUPABASE_URL = "https://mdreidvoocngzailutqy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kcmVpZHZvb2NuZ3phaWx1dHF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2NDA4MDMsImV4cCI6MjA3NzIxNjgwM30.IEKZpeuNAUsI8Q1p5viw1MjAMSTZbaAREx3_1Mxr2Wc";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Source: 2022 Winter Olympics medals (for live testing) ---
const SOURCE_URL = "https://olympics.com/en/api/v1/medals?game=W2022";

// --- Optional: limit first run to a couple sports (delete to ingest all) ---
const ALLOW = new Set(["Biathlon", "Curling"]); // e.g. ["Biathlon","Curling"]; or delete this line + filter below

// -------- Helpers --------
function normalizeDiscipline(raw) {
  if (!raw) return null;
  const key = String(raw).toLowerCase();
  const map = {
    "figure skating": "Figure Skating",
    "short track speed skating": "Short Track Speed Skating",
    "speed skating": "Speed Skating",
    "alpine skiing": "Alpine Skiing",
    "cross-country skiing": "Cross-Country Skiing",
    "freestyle skiing": "Freestyle Skiing",
    "nordic combined": "Nordic Combined",
    "ski jumping": "Ski Jumping",
    "snowboard": "Snowboard",
    "ski mountaineering": "Ski Mountaineering", // not in 2022, but fine to map
    "biathlon": "Biathlon",
    "bobsleigh": "Bobsleigh",
    "skeleton": "Skeleton",
    "luge": "Luge",
    "curling": "Curling",
    "ice hockey": "Ice Hockey"
  };
  return map[key] || String(raw).replace(/\b\w/g, m => m.toUpperCase());
}
const normalizeCountry = c => (c ? String(c).trim().toUpperCase() : null);

// olympics.com medals payload adapter (works for W2022)
function parseFeed(json) {
  const out = [];
  const sets = json?.medalSets || [];
  for (const m of sets) {
    const id =
      m.id ||
      m.eventUnit?.eventUnitId ||
      (globalThis.crypto?.randomUUID?.() ?? `EVT-${Math.random().toString(36).slice(2)}`);

    const ts = m.timestamp || m.lastUpdated || new Date().toISOString();
    const discipline = normalizeDiscipline(
      m.eventUnit?.discipline?.description ||
      m.eventUnit?.discipline?.name ||
      m.discipline
    );

    const add = (noc, medal) => {
      const country = normalizeCountry(noc);
      if (!country || !discipline) return;
      out.push({ event_id: `${id}-${medal}`, ts, discipline, country, medal });
    };

    // Some feeds use medalResults.GOLD/SILVER/BRONZE; some use gold/silver/bronze
    const g = m.medalResults?.GOLD?.countryCode ?? m.gold;
    const s = m.medalResults?.SILVER?.countryCode ?? m.silver;
    const b = m.medalResults?.BRONZE?.countryCode ?? m.bronze;

    if (g) add(g, "G");
    if (s) add(s, "S");
    if (b) add(b, "B");
  }
  return out;
}

// -------- Main --------
async function main() {
  console.log("[Updater] Fetching:", SOURCE_URL);
  const res = await fetch(SOURCE_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Source HTTP ${res.status}`);
  const json = await res.json();

  let medals = parseFeed(json);

  // Apply optional discipline filter for a light first run
  if (ALLOW && ALLOW.size > 0) {
    medals = medals.filter(m => ALLOW.has(m.discipline));
  }

  if (!medals.length) {
    console.log("[Updater] No medals after parsing/filtering.");
    return;
  }

  let upserted = 0, failed = 0;
  // Upsert by unique event_id (e.g., EVENTID-G/S/B) to dedupe safely
  for (const m of medals) {
    const { error } = await sb.from("results").upsert(m, { onConflict: "event_id" });
    if (error) {
      failed++;
      console.error("[upsert error]", error.message, m);
    } else {
      upserted++;
    }
  }
  console.log(`[Updater] Upserted ${upserted}, Failed ${failed}`);
}

main().catch(e => {
  console.error("[Updater] Fatal:", e);
  process.exit(1);
});
