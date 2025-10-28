// scrape-w2022-wikipedia.js
// Node 20+. Scrapes Wikipedia medal tables for Beijing 2022 (event-level).
// Output: results_w2022_wiki.json with rows {discipline, event, country, medal, ts, event_id}

import fs from "node:fs/promises";
import { load as cheerioLoad } from "cheerio";

const URL = "https://en.wikipedia.org/wiki/List_of_2022_Winter_Olympics_medal_winners";

// Common Winter NOCs (good coverage for 2022). Add if you see a miss.
const COUNTRY_TO_NOC = {
  "Norway":"NOR","Sweden":"SWE","Finland":"FIN","United States":"USA","Canada":"CAN",
  "Germany":"GER","Austria":"AUT","Switzerland":"SUI","Italy":"ITA","France":"FRA",
  "Netherlands":"NED","People's Republic of China":"CHN","China":"CHN","Japan":"JPN",
  "South Korea":"KOR","Republic of Korea":"KOR","Great Britain":"GBR","United Kingdom":"GBR",
  "United Team of Germany":"EUA","Russian Olympic Committee":"ROC","Russia":"ROC",
  "Czech Republic":"CZE","Slovakia":"SVK","Poland":"POL","Slovenia":"SLO","Hungary":"HUN",
  "Belgium":"BEL","Spain":"ESP","Australia":"AUS","New Zealand":"NZL","Ukraine":"UKR",
  "Latvia":"LAT","Estonia":"EST","Liechtenstein":"LIE"
};

// Medal text → letter
function medalLetter(x) {
  const s = (x || "").toLowerCase();
  if (s.includes("gold")) return "G";
  if (s.includes("silver")) return "S";
  if (s.includes("bronze")) return "B";
  return null;
}

// For Wikipedia tables we won’t have exact times; pick a stable ISO in 2022.
const DEFAULT_TS = "2022-02-01T00:00:00.000Z";

// Build a deterministic event id
function makeEventId(discipline, event, noc, medal) {
  const slugD = String(discipline).trim().replace(/\s+/g,"-");
  const slugE = String(event).trim().replace(/\s+/g,"-");
  return `W2022-${slugD}-${slugE}-${noc}-${medal}`;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "FantasyOlympics-WikiScraper/1.0 (+github)",
      "Accept": "text/html,application/xhtml+xml"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

// Try to extract the country name out of a medal cell.
// Strategy: take the link immediately after the flagicon, else scan links for one we recognize.
function extractCountryName($, td) {
  const $td = $(td);
  let country = null;

  const flag = $td.find("span.flagicon").first();
  if (flag.length) {
    const nextLink = flag.nextAll('a[title]').first();
    if (nextLink.length) {
      country = nextLink.attr('title');
    }
  }

  if (!country) {
    const links = $td.find("a[title]");
    links.each((_, a) => {
      const title = $(a).attr("title");
      if (COUNTRY_TO_NOC[title]) {
        country = title;
        return false; // break
      }
    });
  }

  // Fallback: sometimes country name text (rare)
  if (!country) {
    const text = $td.text().trim();
    // crude matches for "(USA)" etc.
    const m = text.match(/\(([A-Z]{3})\)/);
    if (m) {
      // reverse-map if we can
      const noc = m[1];
      const name = Object.keys(COUNTRY_TO_NOC).find(k => COUNTRY_TO_NOC[k] === noc);
      if (name) country = name;
    }
  }

  return country || null;
}

// Parse one wikitable: columns usually: Event | Gold | Silver | Bronze
function parseMedalTable($, table, discipline) {
  const rows = [];
  $(table).find("tr").each((i, tr) => {
    if (i === 0) return; // header
    const tds = $(tr).find("td");
    if (tds.length < 4) return;
    const event = $(tds[0]).text().replace(/\[[^\]]*\]/g,"").trim(); // strip refs

    const medalCells = [
      { medal: "G", td: tds[1] },
      { medal: "S", td: tds[2] },
      { medal: "B", td: tds[3] }
    ];

    for (const mc of medalCells) {
      const countryName = extractCountryName($, mc.td);
      if (!countryName) continue;
      const noc = COUNTRY_TO_NOC[countryName];
      if (!noc) continue; // skip if not in map; add mapping above if you see misses

      rows.push({
        discipline,
        event,
        country: noc,
        medal: mc.medal,
        ts: DEFAULT_TS,
        event_id: makeEventId(discipline, event, noc, mc.medal)
      });
    }
  });
  return rows;
}

(async () => {
  try {
    const html = await fetchHtml(URL);
    const $ = cheerioLoad(html);

    const out = [];

    // Wikipedia structure: <h2><span class="mw-headline">Biathlon</span></h2> then one or more .wikitable(s)
    $("h2 .mw-headline").each((_, el) => {
      const discipline = $(el).text().trim();
      if (!discipline) return;

      // Skip non-sport sections like "See also", "Notes".
      const skip = /See also|Notes|References|External links|Medal winners by sport/i.test(discipline);
      if (skip) return;

      // From h2 -> following siblings until next h2; collect .wikitable(s)
      let sib = $(el).closest("h2").next();
      while (sib.length && sib[0].tagName !== "h2") {
        sib.find("table.wikitable").each((__, tbl) => {
          out.push(...parseMedalTable($, tbl, discipline));
        });
        // a .wikitable might be the sibling itself
        if (sib.is("table.wikitable")) {
          out.push(...parseMedalTable($, sib, discipline));
        }
        sib = sib.next();
      }
    });

    // Deduplicate by event_id (rare, but safe)
    const seen = new Set();
    const finalRows = out.filter(r => (seen.has(r.event_id) ? false : (seen.add(r.event_id), true)));

    console.log(`Parsed ${finalRows.length} medal rows from Wikipedia.`);
    await fs.writeFile("results_w2022_wiki.json", JSON.stringify(finalRows, null, 2));
    console.log("Saved results_w2022_wiki.json ✅");
  } catch (e) {
    console.error("Scrape failed:", e.message);
    process.exit(1);
  }
})();
