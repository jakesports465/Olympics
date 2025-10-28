// fetch-medals.js — Node 20, ESM
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mdreidvoocngzailutqy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kcmVpZHZvb2NuZ3phaWx1dHF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2NDA4MDMsImV4cCI6MjA3NzIxNjgwM30.IEKZpeuNAUsI8Q1p5viw1MjAMSTZbaAREx3_1Mxr2Wc";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Primary (live 2022 medals); fallback (your repo)
const PRIMARY_URL  = "https://olympics.com/en/api/v1/medals?game=W2022";
const FALLBACK_URL = "https://raw.githubusercontent.com/jakesports465/Olympics/main/medals.json";

// Optional: limit first runs so we don't dump hundreds immediately
const ALLOW = new Set(["Biathlon","Curling"]); // remove or empty to ingest all

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
    "ski mountaineering": "Ski Mountaineering",
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

function parseFeed(json) {
  const out = [];
  const sets = json?.medalSets || [];
  for (const m of sets) {
    const id = m.id || m.eventUnit?.eventUnitId || `EVT-${Math.random().toString(36).slice(2)}`;
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
    const g = m.medalResults?.GOLD?.countryCode ?? m.gold;
    const s = m.medalResults?.SILVER?.countryCode ?? m.silver;
    const b = m.medalResults?.BRONZE?.countryCode ?? m.bronze;
    if (g) add(g, "G");
    if (s) add(s, "S");
    if (b) add(b, "B");
  }
  return out;
}

async function fetchJson(url, timeoutMs = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  console.log("[Updater] Try primary:", PRIMARY_URL);
  let json;
  try {
    json = await fetchJson(PRIMARY_URL, 8000);
  } catch (e) {
    console.warn("[Updater] Primary failed:", e.message, "→ using fallback");
    json = await fetchJson(FALLBACK_URL, 8000);
  }

  let medals = parseFeed(json);
  if (ALLOW && ALLOW.size) medals = medals.filter(m => ALLOW.has(m.discipline));

  if (!medals.length) {
    console.log("[Updater] No medals after parsing/filtering.");
    return;
  }

  let upserted = 0, failed = 0;
  for (const m of medals) {
    const { error } = await sb.from("results").upsert(m, { onConflict: "event_id" });
    if (error) { failed++; console.error("[upsert error]", error.message); }
    else upserted++;
  }
  console.log(`[Updater] Upserted ${upserted}, Failed ${failed}`);
}

main().catch(e => { console.error("[Updater] Fatal:", e); process.exit(1); });
