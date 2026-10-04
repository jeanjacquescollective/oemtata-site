// Alle tijden zijn Belgische lokale tijd zoals de terminal ze geeft. We rekenen
// in "naïeve" UTC-milliseconden zodat zomer/wintertijd niets verschuift.

export const pad = (n, w = 2) => String(n).padStart(w, '0');

export function isoDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// "2026-09-27" + "53207" -> 2026-09-27T05:32:07
export function toLocalStamp(date, time) {
  const t = String(time).replace(/\D/g, '').padStart(6, '0');
  return `${date}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
}

export function stampMs(stamp) {
  const [d, t] = stamp.split('T');
  const [h, mi, s] = t.split(':').map(Number);
  return parseIso(d) + ((h * 60 + mi) * 60 + s) * 1000;
}

// Cafédag: alles voor CUTOFF_HOUR 's ochtends hoort bij de dag ervoor.
export function businessDay(stamp, cutoffHour) {
  return isoDate(stampMs(stamp) - cutoffHour * 3600_000);
}

export const addDays = (iso, n) => isoDate(parseIso(iso) + n * 86400_000);

export function todayLocal() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts; // YYYY-MM-DD
}

// Maandag van de ISO-week
export function weekStart(iso) {
  const ms = parseIso(iso);
  const dow = (new Date(ms).getUTCDay() + 6) % 7;
  return isoDate(ms - dow * 86400_000);
}

export function isoWeek(iso) {
  const d = new Date(parseIso(iso));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d - jan4) / 86400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}

export const toBe = (iso) => iso.split('-').reverse().join('/');
