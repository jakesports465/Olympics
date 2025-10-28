// scrape-w2022-wikipedia.js (printable version)
// Node 20+. Produces results_w2022_wiki.json

import fs from "node:fs/promises";
import { load as cheerioLoad } from "cheerio";

const PRINT_URL =
  "https://en.wikipedia.org/w/index.php?title=List_of_2022_Winter_Olympics_medal_winners&printable=yes&lang=en";

const COUNTRY_TO_NOC = {
  "Norway":"NOR","Sweden":"SWE","Finland":"FIN","United States":"USA","Canada":"CAN",
  "Germany":"GER","Austria":"AUT","Switzerland":"SUI","Italy":"ITA","France":"FRA",
  "Netherlands":"NED","People's Republic of China":"CHN","China":"CHN","Japan":"JPN",
  "South Korea":"KOR","Republic of Korea":"KOR","Great Britain":"GBR","United Kingdom":"GBR",
  "Team GB":"GBR","Russian Olympic Committee":"ROC","Russia":"ROC","Czech Republic":"CZE",
  "Slovakia":"SVK","Poland":"POL","Slovenia":"SLO","Hungary":"HUN","Belgium":"BEL",
  "Spain":"ESP","Australia":"AUS","New Zealand":"NZL","Ukraine":"UKR","Latvia":"LAT",
  "Estonia":"EST","Liechtenstein":"LIE","Denmark":"DEN"
};

const DEFAULT_TS = "2022-02-01T00:00:00.000Z";

function makeId(disc, evt, noc, m){
  return `W2022-${disc.replace(/\s+/g,"-")}-${evt.replace(/\s+/g,"-")}-${noc}-${m}`;
}

async function fetchHtml(url){
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 (FantasyOlympics/1.0)",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

function tdCountry($, td){
  const $td = $(td);
  const flag = $td.find("span.flagicon").first();
  if (flag.length){
    const link = flag.nextAll('a[title]').first();
    if (link.length) return link.attr("title");
  }
  const linkAny = $td.find('a[title]').toArray().map(a=>$(a).attr('title'));
  for (const t of linkAny){ if (COUNTRY_TO_NOC[t]) return t; }
  const raw = $td.text().replace(/\[[^\]]*\]/g,"").trim();
  for (const name of Object.keys(COUNTRY_TO_NOC)){ if (raw.includes(name)) return name; }
  return null;
}

function parse($){
  const rows = [];

  // On printable view, sports are plain <h2> headings; medal tables right after.
  $("h2").each((_, h2) => {
    const discipline = $(h2).text().replace(/\[edit\]$/, "").trim();
    let sib = $(h2).next();

    while (sib.length) {
      const tag = (sib[0].tagName || "").toLowerCase();
      if (/^h[1-6]$/.test(tag)) break; // next section

      // Parse any wikitable in this block
      sib.find("table.wikitable").addBack("table.wikitable").each((__, tbl) => {
        $(tbl).find("tr").each((i, tr) => {
          if (i===0) return; // header
          const tds = $(tr).find("td");
          if (tds.length < 4) return;

          const event = $(tds[0]).text().replace(/\[[^\]]*\]/g,"").trim();
          const medalCells = [
            { medal:"G", td: tds[1] },
            { medal:"S", td: tds[2] },
            { medal:"B", td: tds[3] }
          ];

          for (const mc of medalCells){
            const countryName = tdCountry($, mc.td);
            if (!countryName) continue;
            const noc = COUNTRY_TO_NOC[countryName];
            if (!noc) continue;
            rows.push({
              discipline,
              event,
              country: noc,
              medal: mc.medal,
              ts: DEFAULT_TS,
              event_id: makeId(discipline, event, noc, mc.medal)
            });
          }
        });
      });

      sib = sib.next();
    }
  });

  // Dedup
  const seen = new Set();
  return rows.filter(r => (seen.has(r.event_id) ? false : (seen.add(r.event_id), true)));
}

(async () => {
  try {
    const html = await fetchHtml(PRINT_URL);

    // DEBUG: quick guard so we know if we actually got the page
    if (!html || html.length < 10_000){
      console.error("Page too small; got", html?.length, "bytes");
      console.error(String(html).slice(0,300));
      process.exit(1);
    }

    const $ = cheerioLoad(html);
    const out = parse($);
    console.log(`Parsed ${out.length} medal rows.`);
    await fs.writeFile("results_w2022_wiki.json", JSON.stringify(out, null, 2));
    console.log("Saved results_w2022_wiki.json ✅");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
