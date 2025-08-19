import fs from 'fs/promises';
import { existsSync } from 'fs';
import { load } from 'cheerio';

const todayISO = new Date().toISOString().slice(0,10);

async function readJsonSafe(path, def = null) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch { return def; }
}

function uniq(arr) {
  return [...new Set(arr)];
}

function cleanLine(t) {
  return t
    .replace(/\s+/g, ' ')
    .replace(/\s*[:\-–]\s*/g, m => m.trim() + ' ') // normalizácia medzier okolo :
    .trim();
}

function sanitizeLines(lines) {
  return uniq(lines
    .map(x => x.replace(/[\t\r]+/g, '').replace(/\u00A0/g, ' ')) // non‑breaking space
    .map(x => x.replace(/\s*•\s*/g, ' • '))
    .map(cleanLine)
    .filter(Boolean)
    .filter(t => !/^(pondelok|utorok|streda|štvrtok|piatok|sobota|nedeľa)\b/i.test(t))
    .filter(t => !/^denné\s+menu\b/i.test(t))
    .filter(t => t !== '•' && t !== '-' && t !== '—')
    .slice(0, 48) // bezpečný limit
  );
}

function splitBlock(text) {
  // rozsekaj podľa newline, odrážok a <br> ktoré už neskôr nahradíme newline
  const parts = text
    .split(/\n|•|·|∙|\u2022|;|<br\s*\/?>/i)
    .map(t => t.replace(/<[^>]+>/g, '')) // istota
    .map(cleanLine)
    .filter(Boolean);
  return sanitizeLines(parts);
}

async function scrapeMenu(url, cfg = {}) {
  if (!url) return { items: [], debug: 'no-url' };
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (LunchBot)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let html = await res.text();
    // Pre istotu nahraď <br> → \n
    html = html.replace(/<br\s*\/?>/gi, '\n');

    const $ = load(html);

    // Ak je definovaný container, obmeďme vyhľadávanie doň (ak existuje)
    let $root = $;
    if (cfg.container) {
      const found = $(cfg.container);
      if (found.length) $root = found;
    }

    // 1) Priame položky (li, .menu-item…)
    const selectors = Array.isArray(cfg.selectors) ? cfg.selectors : (cfg.selectors ? [cfg.selectors] : []);
    let items = [];
    for (const sel of selectors) {
      const arr = $root(sel).map((_, el) => $(el).text()).get();
      items.push(...arr);
    }
    items = sanitizeLines(items);

    // 2) Ak málo položiek, skús veľké bloky a split
    if (items.length < 3) {
      const blockSelectors = Array.isArray(cfg.blockSelectors) ? cfg.blockSelectors : (cfg.blockSelectors ? [cfg.blockSelectors] : []);
      let bigText = '';
      if (blockSelectors.length) {
        for (const bsel of blockSelectors) {
          $root(bsel).each((_, el) => {
            bigText += '\n' + $(el).text();
          });
        }
      } else {
        bigText = $root.text();
      }
      const extra = splitBlock(bigText);
      // vyfiltruj veľmi krátke či očividné nadpisy
      const filtered = extra.filter(x => x.length > 3 && !/^\d{1,2}\s*\,?\s*(€|eur)/i.test(x));
      items = sanitizeLines([...items, ...filtered]);
    }

    // 3) Ak ešte stále nič, skús tabuľky
    if (items.length < 3) {
      const tbl = $root('table').map((_, el) => $(el).text()).get().join('\n');
      if (tbl) {
        const more = splitBlock(tbl);
        items = sanitizeLines([...items, ...more]);
      }
    }

    // 4) Heuristiky: spojiť "Polievka: ..." a hlavné
    // (nič extra nerobíme – ide nám o zoznam riadkov)

    // Debug text – aby sme vedeli, čo to vytiahlo
    const debug = `URL: ${url}\nSelectors: ${selectors.join(', ') || '-'}\nBlockSelectors: ${ (cfg.blockSelectors||[]).join(', ') || '-'}\nItems(${items.length}):\n- ${items.join('\n- ')}`;

    return { items, debug };
  } catch (e) {
    return { items: [], debug: `SCRAPE ERROR ${url}: ${e?.message || e}` };
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

  const nde = await scrapeMenu(sources?.ndegust?.url, sources?.ndegust);
  const um  = await scrapeMenu(sources?.umedveda?.url, sources?.umedveda);

  const out = {
    date: todayISO,
    ndegust: {
      menu: nde.items.length ? nde.items : prev.ndegust.menu,
      priceBand: sources?.ndegust?.priceBand || prev.ndegust.priceBand || "UNDER_10",
      sourceUrl: sources?.ndegust?.url || prev.ndegust.sourceUrl || ""
    },
    umedveda: {
      menu: um.items.length ? um.items : prev.umedveda.menu,
      priceBand: sources?.umedveda?.priceBand || prev.umedveda.priceBand || "UNDER_15",
      sourceUrl: sources?.umedveda?.url || prev.umedveda.sourceUrl || ""
    },
    tips: prev.tips
  };

  await fs.writeFile('data.json', JSON.stringify(out, null, 2), 'utf8');

  // Ulož debug výstup, aby si videl, čo sa našlo
  await fs.writeFile('scrape_ndegust.txt', nde.debug, 'utf8');
  await fs.writeFile('scrape_umedveda.txt', um.debug, 'utf8');

  console.log('data.json aktualizované na', todayISO);
}

run().catch(async (err) => {
  console.error('Chyba generovania:', err);
  const ph = placeholderData();
  await fs.writeFile('data.json', JSON.stringify(ph, null, 2), 'utf8');
  await fs.writeFile('scrape_ndegust.txt', `ERROR: ${err?.message || err}`, 'utf8');
  await fs.writeFile('scrape_umedveda.txt', `ERROR: ${err?.message || err}`, 'utf8');
  process.exit(0);
});
