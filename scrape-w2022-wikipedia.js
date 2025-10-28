// scrape-w2022-wikipedia.js (rev2)
// Node 20+. Scrapes Wikipedia medal tables for Beijing 2022 (event-level).
// Output: results_w2022_wiki.json with rows {discipline, event, country, medal, ts, event_id}

import fs from "node:fs/promises";
import { load as cheerioLoad } from "cheerio";

const URL = "https://en.wikipedia.org/wiki/List_of_2022_Winter_Olympics_medal_winners";

// Expanded mapping for Winter NOCs
const COUNTRY_TO_NOC = {
  "Norway":"NOR","Sweden":"SWE","Finland":"FIN","United States":"USA","Canada":"CAN",
  "Germany":"GER","Austria":"AUT","Switzerland":"SUI","Italy":"ITA","France":"FRA",
  "Netherlands":"NED","People's Republic of China":"CHN","China":"CHN","Japan":"JPN",
  "South Korea":"KOR","Republic of Korea":"KOR",
  "Great Britain":"GBR","United Kingdom":"GBR","Team GB":"GBR",
  "Russian Olympic Committee":"ROC","Russia":"ROC",
  "Czech Republic":"CZE","Slovakia":"SVK","Poland":"POL","Slovenia":"SLO","Hungary":"HUN",
  "Belgium":"BEL","Spain":"ESP","Australia":"AUS","New Zealand":"NZL","Ukraine":"UKR",
  "Latvia":"LAT","Estonia":"EST","Liechtenstein":"LIE","Denmark":"DEN"
};

const DEFAULT_TS = "2022-02-01T00:00:00.000Z";

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

// Extract a country name out of a medal <td>
function extractCountryName($, td) {
  const $td = $(td);

  // 1) Typical: <span class="flagicon">…</span> <a title="Netherlands">Netherlands</a>
  const flag = $td.find("span.flagicon").first();
  if (flag.length) {
    const nextLink = flag.nextAll('a[title]').first();
    if (nextLink.length) return nextLink.attr("title");
  }

  // 2) Any link in the cell whose title matches a known country
  const links = $td.find("a[title]");
  for (const a of links.toArray()) {
    const title = $(a).attr("title");
    if (COUNTRY_TO_NOC[title]) return title;
  }

  // 3) Fallback: raw text scan (very rare)
  const raw = $td.text().replace(/\[[^\]]*\]/g,"").trim();
  for (const name of Object.keys(COUNTRY_TO_NOC)) {
    if (raw.includes(name)) return name;
  }
  return null;
}

function parseMedalTable($, table, discipline) {
  const rows = [];
  $(table).find("tr").each((i, tr) => {
    if (i === 0) return; // header
    const tds = $(tr).find("td");
    if (tds.length < 4) return;

    const event = $(tds[0]).text().replace(/\[[^\]]*\]/g,"").trim();
    if (!event) return;

    // cells: Gold, Silver, Bronze
    const medalCells = [
      { medal: "G", td: tds[1] },
      { medal: "S", td: tds[2] },
      { medal: "B", td: tds[3] }
    ];

    for (const mc of medalCells) {
      const countryName = extractCountryName($, mc.td);
      if (!countryName) continue;
      const noc = COUNTRY_TO_NOC[countryName];
      if (!noc) continue;

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

// Walk siblings from a heading node until next heading of SAME OR HIGHER level
function collectTablesFromSection($, headingEl) {
  const out = [];
  const tag = headingEl.tagName.toLowerCase();
  const level = Number(tag.replace("h","")); // 2 or 3

  let sib = $(headingEl).next();
  while (sib.length) {
    const tagName = (sib[0].tagName || "").toLowerCase();
    if (/^h[1-6]$/.test(tagName)) {
      const nextLevel = Number(tagName.slice(1));
      if (nextLevel <= level) break; // stop at same or higher section
    }

    // Look for medal tables
    if (sib.is("table.wikitable") || sib.find("table.wikitable").length) {
      const discipline = $(headingEl).find(".mw-headline").first().text().trim();
      const tables = sib.is("table.wikitable")
        ? [sib]
        : sib.find("table.wikitable").toArray().map(el => $(el));

      for (const $tbl of tables) {
        out.push({ discipline, tbl: $tbl });
      }
    }
    sib = sib.next();
  }
  return out;
}

(async () => {
  try {
    const html = await fetchHtml(URL);
    const $ = cheerioLoad(html);

    const sections =
      $("h2 .mw-headline, h3 .mw-headline")
        .toArray()
        .map(span => $(span).closest("h2, h3")[0]);

    const candidates = [];
    for (const h of sections) {
      candidates.push(...collectTablesFromSection($, h));
    }

    const out = [];
    for (const { discipline, tbl } of candidates) {
      out.push(...parseMedalTable($, tbl, discipline));
    }

    const seen = new Set();
    const finalRows = out.filter(r => (seen.has(r.event_id) ? false : (seen.add(r.event_id), true)));

    console.log(`Parsed ${finalRows.length} medal rows from Wikipedia.`);
    await fs.writeFile("results_w2022_wiki.json", JSON.stringify(finalRows, null, 2));
    console.log("Saved results_w2022_wiki.json ✅");
  } catch (e) {
    console.error("Scrape failed:", e);
    process.exit(1);
  }
})();
