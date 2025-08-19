import fs from 'fs/promises';
import { existsSync } from 'fs';
import cheerio from 'cheerio'; // HTML parser
// Node 20 má fetch v jadre

const todayISO = new Date().toISOString().slice(0,10);

async function readJsonSafe(path, def = null) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch { return def; }
}

function sanitizeLines(lines) {
  return lines
    .map(t => t.replace(/\s+/g, ' ').trim())
    .filter(t => t && !/^(\*|·|-)$/.test(t))
    .filter(t => !/^(pondelok|utorok|streda|štvrtok|piatok|sobota|nedeľa)\b/i.test(t)) // odfiltruje nadpisy dní
    .slice(0, 24); // bezpečný limit
}

async function scrapeMenu(url, selector) {
  if (!url) return [];
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const sel = selector || 'li';
    const items = $(sel).map((_, el) => $(el).text()).get();
    return sanitizeLines(items);
  } catch (e) {
    console.warn('Scrape zlyhal pre', url, e?.message || e);
    return [];
  }
}

function placeholderData() {
  return {
    date: todayISO,
    ndegust: { menu: [], priceBand: "UNDER_10", sourceUrl: "" },
    umedveda: { menu: [], priceBand: "UNDER_15", sourceUrl: "" },
    tips: []
  };
}

function normalizeToV2(data) {
  // podpora starého formátu {soup, main} -> preklop na menu[]
  const toMenu = (obj) => {
    if (!obj) return { menu: [], priceBand: "UNDER_10" };
    if (Array.isArray(obj.menu)) return { menu: obj.menu, priceBand: obj.priceBand || "UNDER_10", sourceUrl: obj.sourceUrl || "" };
    const items = [];
    if (obj.soup) items.push(`Polievka: ${obj.soup}`);
    if (obj.main) items.push(obj.main);
    return { menu: items, priceBand: obj.priceBand || "UNDER_10", sourceUrl: obj.sourceUrl || "" };
  };

  const tips = Array.isArray(data?.tips) ? data.tips.map(t => ({
    name: t.name || 'Tip',
    dish: t.dish || '—',
    priceBand: t.priceBand || 'UNDER_10',
    url: t.url || ''
  })) : [];

  return {
    date: data?.date || todayISO,
    ndegust: toMenu(data?.ndegust),
    umedveda: toMenu(data?.umedveda),
    tips
  };
}

async function run() {
  // načítaj zdroje (URL + selektory)
  const sources = await readJsonSafe('sources.json', { ndegust: {}, umedveda: {} });

  // načítaj doterajší data.json (pre fallback/normalizáciu)
  const prev = normalizeToV2(await readJsonSafe('data.json', placeholderData()));

  // SCRAPE
  const ndeMenu = await scrapeMenu(sources?.ndegust?.url, sources?.ndegust?.selector);
  const umMenu  = await scrapeMenu(sources?.umedveda?.url, sources?.umedveda?.selector);

  // poskladaj výsledok
  const out = {
    date: todayISO,
    ndegust: {
      menu: ndeMenu.length ? ndeMenu : prev.ndegust.menu, // ak scrape nič nenašiel, nechá predchádzajúce položky
      priceBand: sources?.ndegust?.priceBand || prev.ndegust.priceBand || "UNDER_10",
      sourceUrl: sources?.ndegust?.url || prev.ndegust.sourceUrl || ""
    },
    umedveda: {
      menu: umMenu.length ? umMenu : prev.umedveda.menu,
      priceBand: sources?.umedveda?.priceBand || prev.umedveda.priceBand || "UNDER_15",
      sourceUrl: sources?.umedveda?.url || prev.umedveda.sourceUrl || ""
    },
    tips: prev.tips // tipy nechávame, alebo si ich budeš udržiavať ručne/cez model
  };

  await fs.writeFile('data.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('data.json aktualizované na', todayISO);
}

run().catch(async (err) => {
  console.error('Chyba generovania:', err);
  // posledná záchrana – nech data.json existuje
  const ph = placeholderData();
  await fs.writeFile('data.json', JSON.stringify(ph, null, 2), 'utf8');
  process.exit(0);
});
