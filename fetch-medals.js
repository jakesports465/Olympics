// fetch-medals.js — Node 18+, ESM

import { createClient } from "@supabase/supabase-js";

// --- 1) Your Supabase project (hard-coded) ---
const SUPABASE_URL = "https://mdreidvoocngzailutqy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kcmVpZHZvb2NuZ3phaWx1dHF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2NDA4MDMsImV4cCI6MjA3NzIxNjgwM30.IEKZpeuNAUsI8Q1p5viw1MjAMSTZbaAREx3_1Mxr2Wc";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- 2) Medal feed (test) ---
const SOURCE_URL = "https://raw.githubusercontent.com/jakesports465/Olympics/main/medals.json";
// For live Games later: "https://olympics.com/en/api/v1/medals?game=W2026"

// --- 3) Helpers ---
function normalizeDiscipline(raw) {
  if (!raw) return null;
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
  const key = String(raw).toLowerCase();
  return map[key] || String(raw).replace(/\b\w/g, m => m.toUpperCase());
}
const normalizeCountry = c => (c ? String(c).trim().toUpperCase() : null);

// --- 4) Parse olympics.com-style JSON ---
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
    if (m.gold || m.medalResults?.GOLD?.countryCode) add(m.gold ?? m.medalResults?.GOLD?.countryCode, "G");
    if (m.silver || m.medalResults?.SILVER?.countryCode) add(m.silver ?? m.medalResults?.SILVER?.countryCode, "S");
    if (m.bronze || m.medalResults?.BRONZE?.countryCode) add(m.bronze ?? m.medalResults?.BRONZE?.countryCode, "B");
  }
  return out;
}

// --- 5) Main ---
async function main() {
  console.log("[Updater] Fetching medals…");
  const res = await fetch(SOURCE_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Source HTTP ${res.status}`);
  const json = await res.json();
  const medals = parseFeed(json);
  if (!medals.length) return console.log("[Updater] No medals found yet.");

  let upserted = 0, failed = 0;
  for (const m of medals) {
    const { error } = await sb.from("results").upsert(m, { onConflict: "event_id" });
    if (error) { failed++; console.error("[upsert]", error.message); }
    else upserted++;
  }
  console.log(`[Updater] Upserted ${upserted}, Failed ${failed}`);
}

main().catch(e => {
  console.error("[Updater] Fatal:", e);
  process.exit(1);
});
