import fs from 'fs/promises';
import { existsSync } from 'fs';
import { OpenAI } from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const todayISO = new Date().toISOString().slice(0,10);

const systemPrompt = `
Si pomocník pre denné obedy v lokalite Chorvátsky Grob – Čierna Voda (Slovensko).
Vráť IBA platný JSON podľa tejto schémy:
{
  "date": "YYYY-MM-DD",
  "ndegust": { "soup": "text|—", "main": "text|—", "priceBand": "UNDER_10|UNDER_15|OVER_20" },
  "umedveda": { "soup": "text|—", "main": "text|—", "priceBand": "UNDER_10|UNDER_15|OVER_20" },
  "tips": [
    { "name": "string", "dish": "string|—", "priceBand": "UNDER_10|UNDER_15|OVER_20" },
    { "name": "string", "dish": "string|—", "priceBand": "UNDER_10|UNDER_15|OVER_20" },
    { "name": "string", "dish": "string|—", "priceBand": "UNDER_10|UNDER_15|OVER_20" },
    { "name": "string", "dish": "string|—", "priceBand": "UNDER_10|UNDER_15|OVER_20" }
  ]
}
Požiadavky:
- Zahrň Ndegust a U Medveďa vždy.
- Pridaj 4 tipy v okruhu do 15 km od Čiernej Vody (Bratislava-okolie).
- Ak si si nie istý konkrétnym obedovým menu, použi „—“ a zvoľ typické jedlá; cenové pásmo odhadni realisticky.
- Nepíš žiadne komentáre, iba čistý JSON.
`;

function placeholderData() {
  return {
    date: todayISO,
    ndegust: { soup: "—", main: "—", priceBand: "UNDER_10" },
    umedveda: { soup: "—", main: "—", priceBand: "UNDER_15" },
    tips: [
      { name: "Slovenský Grob – Husacina", dish: "—", priceBand: "OVER_20" },
      { name: "Ivanka pri Dunaji – Viet Bistro", dish: "—", priceBand: "UNDER_15" },
      { name: "Rača – Pizza", dish: "—", priceBand: "UNDER_10" },
      { name: "Bernolákovo – Reštaurácia", dish: "—", priceBand: "UNDER_15" }
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
          { role: "user", content: `Dátum: ${todayISO}. Vygeneruj JSON podľa schémy vyššie.` }
        ],
        response_format: { type: "json_object" }
      });
      return completion.choices[0].message.content;
    } catch (err) {
      const code = err?.code || err?.error?.code;
      const status = err?.status;
      console.warn(`Pokus ${i+1} z ${maxRetries} zlyhal – code=${code} status=${status}`);
      // Pri 429/insufficient_quota backoff a skúsiť znova
      if (status === 429 || code === 'insufficient_quota') {
        await new Promise(r => setTimeout(r, 2000 * (i + 1))); // 2s, 4s, 6s
        continue;
      }
      // Iné chyby – hneď padneme do fallbacku
      throw err;
    }
  }
  // Po max retry vrátime null -> fallback
  return null;
}

async function run() {
  let json = await tryRequestWithRetry();

  if (json) {
    try {
      const data = JSON.parse(json);
      data.date = todayISO;
      await writeData(data);
      return;
    } catch (e) {
      console.error("Neplatný JSON z modelu, prechádzam na fallback.");
    }
  } else {
    console.warn("Model nedostupný/limit – prechádzam na fallback.");
  }

  // Fallback: ak existuje včerajší/posledný data.json, skopíruj ho s dnešným dátumom
  if (existsSync('data.json')) {
    try {
      const prev = JSON.parse(await fs.readFile('data.json', 'utf8'));
      prev.date = todayISO;
      await writeData(prev);
      return;
    } catch (e) {
      console.error("Nepodarilo sa načítať existujúci data.json, vytváram placeholder.");
    }
  }

  // Posledná možnosť: placeholder
  const ph = placeholderData();
  await writeData(ph);
}

run().catch(err => {
  console.error("Nezachytená chyba skriptu:", err);
  // Aj pri chybe vytvoríme placeholder, aby job neskončil chybou a web fungoval
  const ph = placeholderData();
  writeData(ph).catch(() => process.exit(1));
});
