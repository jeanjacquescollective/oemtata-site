// Leest alle CSV's uit import/ en voegt ze samen in data/transactions.json.
// Overlappende exports zijn geen probleem: dubbels worden herkend.
import fs from 'node:fs';
import path from 'node:path';
import { IMPORT_DIR, CUTOFF_HOUR } from './lib/config.mjs';
import { loadStore, saveStore } from './lib/store.mjs';
import { parseEbOnlineCsv, txKey } from './lib/parse.mjs';
import { businessDay } from './lib/dates.mjs';


const store = loadStore();

// Telling per sleutel: twee identieke betalingen in dezelfde seconde blijven
// er twee, zolang ze in eenzelfde export ook twee keer voorkomen.
const counts = new Map();
const byKey = new Map();
const add = (list) => {
  const local = new Map();
  for (const t of list) {
    const k = txKey(t);
    local.set(k, (local.get(k) ?? 0) + 1);
    // De commissie staat pas in de export als de betaling verrekend is: een
    // latere export met commissie vervangt een eerdere zonder.
    const known = byKey.get(k);
    if (!known || (!known.fee && t.fee)) byKey.set(k, t);
  }
  for (const [k, n] of local) counts.set(k, Math.max(counts.get(k) ?? 0, n));
};

// Bestaande data opnieuw indelen voor het geval DAY_CUTOFF_HOUR veranderde.
add(store.transactions.map((t) => ({ ...t, day: businessDay(t.ts, CUTOFF_HOUR) })));
const before = store.transactions.length;

const files = fs.existsSync(IMPORT_DIR) ? fs.readdirSync(IMPORT_DIR).filter((f) => /\.csv$/i.test(f)) : [];
for (const f of files) {
  const rows = parseEbOnlineCsv(fs.readFileSync(path.join(IMPORT_DIR, f), 'latin1'), CUTOFF_HOUR);
  add(rows);
}

const transactions = [];
for (const [k, n] of counts) for (let i = 0; i < n; i++) transactions.push(byKey.get(k));
transactions.sort((a, b) => a.ts.localeCompare(b.ts));

saveStore({ updated: new Date().toISOString(), transactions });
console.log(`${files.length} bestand(en) gelezen. ${transactions.length} transacties (${transactions.length - before >= 0 ? '+' : ''}${transactions.length - before} nieuw).`);
console.log(`Periode: ${transactions[0]?.day ?? '-'} t.e.m. ${transactions.at(-1)?.day ?? '-'}`);
