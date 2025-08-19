import fs from 'fs/promises';
import { existsSync } from 'fs';
import { OpenAI } from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const todayISO = new Date().toISOString().slice(0,10);

const systemPrompt = `
Si pomocník pre denné obedy v lokalite Chorvátsky Grob – Čierna Voda (Slovensko).
Vráť IBA platný JSON podľa tejto schémy (V2):
{
  "date": "YYYY-MM-DD",
  "ndegust": {
    "menu": ["string", "string", "string"],  // každý riadok jedna položka denného menu (polievka, hlavné 1, hlavné 2, ...)
    "priceBand": "UNDER_10|UNDER_15|OVER_20"
  },
  "umedveda": {
    "menu": ["string", "string", "string"],
    "priceBand": "UNDER_10|UNDER_15|OVER_20"
  },
  "tips": [
    { "name": "string", "dish": "string|—", "priceBand": "UNDER_10|UNDER_15|OVER_20", "url": "https://..." },
    { "name": "string", "dish": "string|—", "priceBand": "UNDER_10|UNDER_15|OVER_20", "url": "https://..." },
    { "name": "string", "dish": "string|—", "priceBand": "UNDER_10|UNDER_15|OVER_20", "url": "https://..." },
    { "name": "string", "dish": "string|—", "priceBand": "UNDER_10|UNDER_15|OVER_20", "url": "https://..." }
  ]
}
Požiadavky:
- Zahrň Ndegust a U Medveďa vždy.
- Pri Ndegust a U Medveďa použi pole "menu" s viacerými položkami. Ak nevieš, nechaj prázdny zoznam [].
- 4 tipy v okruhu do 15 km od Čiernej Vody; vždy pridaj "url" na zdroj (ak si neistý, použi reštauračný web, Facebook stránku alebo Google Mapy URL).
- Nepíš žiadne komentáre, iba čistý JSON.
`;

function placeholderData() {
  return {
    date: todayISO,
    ndegust: { menu: [], priceBand: "UNDER_10" },
    umedveda: { menu: [], priceBand: "UNDER_15" },
    tips: [
      { name: "Slovenský Grob – Husacina", dish: "—", priceBand: "OVER_20", url: "https://www.google.com/maps" },
      { name: "Ivanka pri Dunaji – Viet Bistro", dish: "—", priceBand: "UNDER_15", url: "https://www.google.com/maps" },
      { name: "Rača – Pizza", dish: "—", priceBand: "UNDER_10", url: "https://www.google.com/maps" },
      { name: "Bernolákovo – Reštaurácia", dish: "—", priceBand: "UNDER_15", url: "https://www.google.com/maps" }
    ]
  };
}

async function writeData(data) {
  await fs.writeFile('data.json', JSON.stringify(data, null, 2), 'utf8');
  console.log("data.json aktualizované na", data.date);
}

async function tryRequestWithRetry() {
  const maxRetries = 3;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Dátum: ${todayISO}. Vráť JSON podľa schémy V2.` }
        ],
        response_format: { type: "json_object" }
      });
      return completion.choices[0].message.content;
    } catch (err) {
      const code = err?.code || err?.error?.code;
      const status = err?.status;
      console.warn(`Pokus ${i+1} z ${maxRetries} zlyhal – code=${code} status=${status}`);
      if (status === 429 || code === 'insufficient_quota') {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function run() {
  let json = await tryRequestWithRetry();

  if (json) {
    try {
      const data = JSON.parse(json);
      data.date = todayISO;

      // Bezpečnostná normalizácia
      const norm = {
        date: data.date,
        ndegust: { menu: Array.isArray(data?.ndegust?.menu) ? data.ndegust.menu : [], priceBand: data?.ndegust?.priceBand || "UNDER_10" },
        umedveda: { menu: Array.isArray(data?.umedveda?.menu) ? data.umedveda.menu : [], priceBand: data?.umedveda?.priceBand || "UNDER_15" },
        tips: Array.isArray(data?.tips) ? data.tips.map(t => ({
          name: t.name || "Tip",
          dish: t.dish || "—",
          priceBand: t.priceBand || "UNDER_10",
          url: t.url || "https://www.google.com/maps"
        })) : []
      };

      await writeData(norm);
      return;
    } catch (e) {
      console.error("Neplatný JSON z modelu, prechádzam na fallback.");
    }
  } else {
    console.warn("Model nedostupný/limit – prechádzam na fallback.");
  }

  // Fallback na existujúci súbor
  if (existsSync('data.json')) {
    try {
      const prev = JSON.parse(await fs.readFile('data.json', 'utf8'));
      prev.date = todayISO;
      if (!Array.isArray(prev.ndegust?.menu)) prev.ndegust = { menu: [], priceBand: prev.ndegust?.priceBand || "UNDER_10" };
      if (!Array.isArray(prev.umedveda?.menu)) prev.umedveda = { menu: [], priceBand: prev.umedveda?.priceBand || "UNDER_15" };
      prev.tips = Array.isArray(prev.tips) ? prev.tips.map(t => ({ ...t, url: t.url || "https://www.google.com/maps" })) : [];
      await writeData(prev);
      return;
    } catch (e) {
      console.error("Nepodarilo sa načítať existujúci data.json, vytváram placeholder.");
    }
  }

  // Posledná možnosť: placeholder
  await writeData(placeholderData());
}

run().catch(err => {
  console.error("Nezachytená chyba skriptu:", err);
  writeData(placeholderData()).catch(() => process.exit(1));
});
