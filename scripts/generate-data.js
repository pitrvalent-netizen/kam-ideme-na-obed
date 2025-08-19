import fs from 'fs/promises';
import { existsSync } from 'fs';
import { load } from 'cheerio'; // ESM named import

const todayISO = new Date().toISOString().slice(0,10);

async function readJsonSafe(path, def = null) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch { return def; }
}

function sanitizeLines(lines) {
  return lines
    .map(t => t.replace(/\s+/g, ' ').trim())
    .filter(t => t && !/^(\*|·|-)$/.test(t))
    .filter(t => !/^(pondelok|utorok|streda|štvrtok|piatok|sobota|nedeľa)\b/i.test(t))
    .slice(0, 24);
}

async function scrapeMenu(url, selector) {
  if (!url) return [];
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = load(html);
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
  const toMenu = (obj) => {
    if (!obj) return { menu: [], priceBand: "UNDER_10", sourceUrl: "" };
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
  const sources = await readJsonSafe('sources.json', { ndegust: {}, umedveda: {} });
  const prev = normalizeToV2(await readJsonSafe('data.json', placeholderData()));

  const ndeMenu = await scrapeMenu(sources?.ndegust?.url, sources?.ndegust?.selector);
  const umMenu  = await scrapeMenu(sources?.umedveda?.url, sources?.umedveda?.selector);

  const out = {
    date: todayISO,
    ndegust: {
      menu: ndeMenu.length ? ndeMenu : prev.ndegust.menu,
      priceBand: sources?.ndegust?.priceBand || prev.ndegust.priceBand || "UNDER_10",
      sourceUrl: sources?.ndegust?.url || prev.ndegust.sourceUrl || ""
    },
    umedveda: {
      menu: umMenu.length ? umMenu : prev.umedveda.menu,
      priceBand: sources?.umedveda?.priceBand || prev.umedveda.priceBand || "UNDER_15",
      sourceUrl: sources?.umedveda?.url || prev.umedveda.sourceUrl || ""
    },
    tips: prev.tips
  };

  await fs.writeFile('data.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('data.json aktualizované na', todayISO);
}

run().catch(async (err) => {
  console.error('Chyba generovania:', err);
  const ph = placeholderData();
  await fs.writeFile('data.json', JSON.stringify(ph, null, 2), 'utf8');
  process.exit(0);
});
