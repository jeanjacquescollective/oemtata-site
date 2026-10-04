// Logt in op eb online (gebruikersnaam + paswoord uit .env) en downloadt de
// transacties als CSV naar import/. Gebruik:
//   npm run fetch                       -> vanaf de laatste gekende dag tot vandaag
//   npm run fetch -- --from 2025-01-01  -> eigen periode (ook --to)
//   npm run fetch -- --headed           -> browser zichtbaar (debuggen)
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { IMPORT_DIR, STORE_FILE, MERCHANT_URL, CUTOFF_HOUR } from './lib/config.mjs';
import { loadStore } from './lib/store.mjs';
import { addDays, todayLocal, toBe, parseIso } from './lib/dates.mjs';

const { values: args } = parseArgs({
  options: {
    from: { type: 'string' },
    to: { type: 'string' },
    headed: { type: 'boolean', default: false },
  },
});

const { EB_USERNAME, EB_PASSWORD } = process.env;
if (!EB_USERNAME || !EB_PASSWORD) {
  console.error('EB_USERNAME en EB_PASSWORD ontbreken in .env');
  process.exit(1);
}

function defaultFrom() {
  if (fs.existsSync(STORE_FILE)) {
    const store = loadStore();
    const last = store.transactions.at(-1)?.day;
    // een paar dagen overlap: dubbels worden bij het importeren weggefilterd
    if (last) return addDays(last, -3);
  }
  return addDays(todayLocal(), -400);
}

const to = args.to ?? todayLocal();
const from = args.from ?? defaultFrom();

// De portal exporteert per kalenderdag; een cafédag loopt tot CUTOFF_HOUR de
// dag erna, dus "tot" altijd een dag verder nemen.
const toInclusive = CUTOFF_HOUR > 0 ? addDays(to, 1) : to;

// Periodes in stukken van max. 31 dagen om limieten van de portal te vermijden.
function chunks(a, b) {
  const out = [];
  for (let s = a; parseIso(s) <= parseIso(b); s = addDays(s, 31)) {
    const e = addDays(s, 30);
    out.push([s, parseIso(e) > parseIso(b) ? b : e]);
  }
  return out;
}

async function login(page) {
  await page.goto('https://www.ebonline.be/login', { waitUntil: 'networkidle' });
  const nl = page.getByText('Nederlands', { exact: false }).first();
  if (await nl.isVisible().catch(() => false)) {
    await nl.click();
    await page.waitForLoadState('networkidle');
  }
  // cookiemelding wegklikken
  await page.evaluate(() => document.querySelector('#cookies .btn-primary')?.click());
  await page.locator('a', { hasText: 'paswoord' }).first().click({ force: true });
  await page.locator('[id="standardForm:username"]').fill(EB_USERNAME);
  await page.locator('[id="standardForm:password"]').fill(EB_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/customer\//, { timeout: 30_000 }),
    page.locator('[id="standardForm"] input[type=submit]').click({ force: true }),
  ]).catch(async () => {
    const msg = await page.locator('.alert, .error, .ui-messages').allInnerTexts().catch(() => []);
    throw new Error('Inloggen mislukt. ' + msg.join(' ').trim());
  });
}

async function setDate(page, id, iso) {
  const input = page.locator(`[id="handelszaakForm:${id}"]`);
  // Het veld heeft een invoermasker dat bij typen tekens verliest: waarde
  // rechtstreeks zetten (via de jQuery-datepicker als die er is).
  await input.evaluate((el, v) => {
    const $ = window.jQuery;
    if ($ && $(el).datepicker) $(el).datepicker('setDate', v);
    el.value = v;
    for (const t of ['input', 'change', 'blur']) el.dispatchEvent(new Event(t, { bubbles: true }));
  }, toBe(iso));
  await page.keyboard.press('Escape'); // kalender-popup sluiten
  await page.locator('#ui-datepicker-div').evaluate((el) => (el.style.display = 'none')).catch(() => {});
  const val = await input.inputValue();
  if (val !== toBe(iso)) throw new Error(`Datumveld ${id} bevat "${val}" i.p.v. ${toBe(iso)}`);
}

async function setCheckbox(page, id, on) {
  const box = page.locator(`[id="handelszaakForm:${id}"]`);
  if ((await box.count()) && (await box.isChecked()) !== on) await box.click({ force: true });
}

async function exportRange(page, start, end) {
  await page.goto(MERCHANT_URL, { waitUntil: 'networkidle' });
  await page.getByText('Geavanceerd zoeken en exporteren').click();
  await page.locator('[id="handelszaakForm:startdate"]').waitFor();
  await setDate(page, 'startdate', start);
  await setDate(page, 'enddate', end);
  await setCheckbox(page, 'metVerkopen', true);
  await setCheckbox(page, 'metAnnulatiesVerkopen', true);
  await setCheckbox(page, 'metReserveringen', false);
  await setCheckbox(page, 'metAnnulatiesReserveringen', false);
  await setCheckbox(page, 'metGeweigerdeBetalingen', false);

  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.locator('[id="handelszaakForm:createCsv"]').click();
  const file = path.join(IMPORT_DIR, `ebonline_${start}_${end}.csv`);
  await (await download).saveAs(file);
  return file;
}

fs.mkdirSync(IMPORT_DIR, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || undefined,
  headless: !args.headed,
});
const page = await (await browser.newContext({ acceptDownloads: true, locale: 'nl-BE' })).newPage();

try {
  console.log(`Inloggen op eb online…`);
  await login(page);
  for (const [s, e] of chunks(from, toInclusive)) {
    const file = await exportRange(page, s, e);
    const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).length - 1;
    console.log(`  ${toBe(s)} – ${toBe(e)}: ${rows} transacties -> ${path.relative(process.cwd(), file)}`);
  }
  await page.locator('a[title="Afmelden"]').click().catch(() => {});
} catch (err) {
  const shot = path.join(IMPORT_DIR, 'fout.png');
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  console.error(`\n${err.message}\nScreenshot: ${shot}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
