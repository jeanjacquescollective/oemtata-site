// De volledige transactielijst, versleuteld met STORE_KEY in store/transactions.enc.json.
// Zo kan GitHub Actions er elke week op verderbouwen zonder dat de data leesbaar online staat.
import fs from 'node:fs';
import path from 'node:path';
import { STORE_FILE } from './config.mjs';
import { keyFromBase64, encryptWithKey, decryptWithKey } from './crypto.mjs';

const key = () => keyFromBase64(process.env.STORE_KEY);

export function loadStore() {
  if (!fs.existsSync(STORE_FILE)) return { transactions: [] };
  return decryptWithKey(JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')), key());
}

export function saveStore(store) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(encryptWithKey(store, key())));
}
