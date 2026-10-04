// Maakt uit de (versleutelde) transactielijst in store/:
//   docs/data/data.enc.json    alles wat de site toont, versleuteld met DETAIL_PIN
//   reports/week-YYYY-Www.md   weekoverzicht van de laatste volledige week
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DOCS_DATA_DIR, REPORTS_DIR, CUTOFF_HOUR, DETAIL_PIN } from './lib/config.mjs';
import { loadStore } from './lib/store.mjs';
import { encryptWithPin } from './lib/crypto.mjs';
import { addDays, weekStart, isoWeek, todayLocal, toBe, pad } from './lib/dates.mjs';

if (!DETAIL_PIN) {
  console.error('DETAIL_PIN ontbreekt in .env');
  process.exit(1);
}

const { transactions } = loadStore();
const ok = transactions.filter((t) => t.ok);

// ---- totalen per cafédag (voor het weekrapport) ----
const days = new Map();
for (const t of ok) {
  const d = days.get(t.day) ?? { cents: 0, count: 0 };
  d.cents += t.cents;
  if (t.cents > 0) d.count += 1;
  days.set(t.day, d);
}
// ---- site-data, volledig versleuteld (te ontcijferen met WebCrypto in de browser) ----
const brands = [...new Set(ok.map((t) => t.brand))];
const siteData = {
  generated: new Date().toISOString(),
  cutoffHour: CUTOFF_HOUR,
  lastTransaction: ok.at(-1)?.ts ?? null,
  brands,
  // [tijdstip, bedrag cent, commissie cent, merk-index, kaarttype, land]
  tx: ok.map((t) => [t.ts, t.cents, t.fee, brands.indexOf(t.brand), t.cardType, t.country]),
};

fs.mkdirSync(DOCS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(DOCS_DATA_DIR, 'data.enc.json'), JSON.stringify(encryptWithPin(siteData, DETAIL_PIN)));
// oude, deels onversleutelde bestanden opruimen
for (const old of ['summary.json', 'detail.enc.json']) fs.rmSync(path.join(DOCS_DATA_DIR, old), { force: true });

// ---- weekrapport (laatste volledige week, ma t.e.m. zo) ----
const euro = (c) => '€ ' + (c / 100).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayNames = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
const thisMonday = weekStart(todayLocal());
const monday = addDays(thisMonday, -7);
const prevMonday = addDays(monday, -7);
const weekTotal = (start) => [...Array(7)].reduce((s, _, i) => s + (days.get(addDays(start, i))?.cents ?? 0), 0);
const { year, week } = isoWeek(monday);

const lines = [
  `# Week ${week} (${toBe(monday)} – ${toBe(addDays(monday, 6))})`,
  '',
  `Een dag loopt tot ${pad(CUTOFF_HOUR)}:00 de volgende ochtend.`,
  '',
  '| Dag | Datum | Omzet | Betalingen | Gem. bedrag |',
  '|---|---|---:|---:|---:|',
];
for (let i = 0; i < 7; i++) {
  const day = addDays(monday, i);
  const d = days.get(day) ?? { cents: 0, count: 0 };
  lines.push(`| ${dayNames[i]} | ${toBe(day)} | ${euro(d.cents)} | ${d.count} | ${d.count ? euro(d.cents / d.count) : '–'} |`);
}
const total = weekTotal(monday);
const prev = weekTotal(prevMonday);
const diff = prev ? ((total - prev) / prev) * 100 : null;
lines.push(`| **Totaal** | | **${euro(total)}** | | |`, '');
lines.push(`Vorige week: ${euro(prev)}${diff === null ? '' : ` (${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%)`}`);

fs.mkdirSync(REPORTS_DIR, { recursive: true });
const reportFile = path.join(REPORTS_DIR, `week-${year}-W${pad(week)}.md`);
fs.writeFileSync(reportFile, lines.join('\n') + '\n');

console.log(`${days.size} cafédagen, ${ok.length} betalingen. Site-data bijgewerkt in docs/data/.`);
console.log('\n' + lines.join('\n'));
console.log(`\nRapport: ${path.relative(process.cwd(), reportFile)}`);

// In GitHub Actions: weekoverzicht ook op de samenvattingspagina van de run tonen.
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');

// Cache-busting: index.html verwijst naar app.js/style.css met een hash van de inhoud,
// zodat een browser nooit een oude app.js combineert met een nieuwe pagina.
{
  const docs = path.dirname(DOCS_DATA_DIR);
  const indexFile = path.join(docs, 'index.html');
  let html = fs.readFileSync(indexFile, 'utf8');
  for (const asset of ['app.js', 'style.css']) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(docs, asset))).digest('hex').slice(0, 10);
    html = html.replace(new RegExp(`${asset.replace('.', '[.]')}[?]v=[0-9a-z]+`), `${asset}?v=${hash}`);
  }
  fs.writeFileSync(indexFile, html);
}
