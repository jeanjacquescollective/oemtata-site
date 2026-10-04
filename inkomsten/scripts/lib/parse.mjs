import { toLocalStamp, businessDay } from './dates.mjs';

const euroCents = (s) => Math.round(Number(String(s ?? '0').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) * 100) || 0;

// Parseert een CSV-export van eb online ("Geavanceerd zoeken en exporteren" -> Excel).
// Kolommen: Datum;Tijd;Terminal;Brand;Kaarttype;Reg/Non-Reg;Bedrag;Commissie (EUR);
//           Applicatiekost (EUR);Uw ref;Kaart;Authorisatie nr;Land;Transactietype;Resultaat;Boekingsdatum;OV-ref
export function parseEbOnlineCsv(text, cutoffHour) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = lines[0].split(';').map((h) => h.trim().toLowerCase());
  const col = (name) => header.findIndex((h) => h.startsWith(name));
  const C = {
    date: col('datum'), time: col('tijd'), terminal: col('terminal'), brand: col('brand'),
    cardType: col('kaarttype'), amount: col('bedrag'), fee: col('commissie'), auth: col('authorisatie'),
    country: col('land'),
  };
  if (C.date < 0 || C.time < 0 || C.amount < 0) {
    throw new Error(`Onbekend CSV-formaat, header: ${lines[0]}`);
  }

  const out = [];
  for (const line of lines.slice(1)) {
    const r = line.split(';').map((v) => v.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r[C.date])) continue;
    // In sommige rijen ontbreekt een kolom (bv. transactietype), dus type en
    // resultaat herkennen we aan hun waarde i.p.v. hun positie.
    const type = r.find((v) => /^(verkoop|annul|terugbet|credit)/i.test(v)) ?? 'Verkoop';
    const result = r.find((v) => /^(goedgekeurd|geweigerd|mislukt|geannuleerd)/i.test(v)) ?? 'Goedgekeurd';
    const stamp = toLocalStamp(r[C.date], r[C.time]);
    let cents = euroCents(r[C.amount]);
    if (/annul|terugbet|credit/i.test(type) && cents > 0) cents = -cents;
    out.push({
      ts: stamp,
      day: businessDay(stamp, cutoffHour),
      cents,
      fee: C.fee >= 0 ? euroCents(r[C.fee]) : 0,
      brand: r[C.brand] || 'Onbekend',
      cardType: r[C.cardType] || '',
      country: /^[A-Z]{2}$/.test(r[C.country] ?? '') ? r[C.country] : '',
      type,
      ok: /^goedgekeurd/i.test(result),
      terminal: r[C.terminal] || '',
      auth: r[C.auth] || '',
    });
  }
  return out;
}

// Sleutel om dubbels (overlappende exports) te herkennen.
export const txKey = (t) => `${t.ts}|${t.cents}|${t.auth}|${t.terminal}`;
