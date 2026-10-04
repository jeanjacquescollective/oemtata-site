import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const IMPORT_DIR = path.join(ROOT, 'import');
export const DOCS_DATA_DIR = path.join(ROOT, 'docs', 'data');
export const REPORTS_DIR = path.join(ROOT, 'reports');
export const STORE_FILE = path.join(ROOT, 'store', 'transactions.enc.json');

// `||` i.p.v. `??`: in GitHub Actions is een niet-ingestelde variabele een lege string.
export const CUTOFF_HOUR = Number(process.env.DAY_CUTOFF_HOUR || 6);
export const DETAIL_PIN = process.env.DETAIL_PIN || '';
export const MERCHANT_URL = process.env.EB_MERCHANT_URL || 'https://www.ebonline.be/customer/merchants/166354/16635401';
