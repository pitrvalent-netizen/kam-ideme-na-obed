import fs from 'fs/promises';
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

async function run() {
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Dátum: ${todayISO}. Vygeneruj JSON podľa schémy vyššie.` }
    ],
    response_format: { type: "json_object" }
  });

  const json = completion.choices[0].message.content;
  let data;
  try { data = JSON.parse(json); }
  catch (e) {
    console.error("Neplatný JSON z modelu:", e);
    process.exit(1);
  }
  data.date = todayISO;
  await fs.writeFile('data.json', JSON.stringify(data, null, 2), 'utf8');
  console.log("data.json aktualizované na", todayISO);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
