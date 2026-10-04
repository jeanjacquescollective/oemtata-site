import crypto from 'node:crypto';

// AES-256-GCM; de auth-tag zit achteraan de ciphertext (zoals WebCrypto verwacht).
function seal(obj, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { iv: iv.toString('base64'), data: data.toString('base64') };
}

function open({ iv, data }, key) {
  const buf = Buffer.from(data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(buf.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(0, -16)), decipher.final()]).toString('utf8'));
}

// Met PIN (voor het detailscherm, te ontcijferen in de browser).
export function encryptWithPin(obj, pin) {
  const iter = 250_000;
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(pin, salt, iter, 32, 'sha256');
  return { v: 1, iter, salt: salt.toString('base64'), ...seal(obj, key) };
}

// Met een willekeurige 256-bit sleutel (base64), voor de volledige transactielijst.
export function keyFromBase64(b64) {
  const key = Buffer.from(b64 ?? '', 'base64');
  if (key.length !== 32) throw new Error('STORE_KEY moet 32 bytes in base64 zijn (genereer met: node -e "console.log(crypto.randomBytes(32).toString(\'base64\'))")');
  return key;
}
export const encryptWithKey = (obj, key) => ({ v: 1, ...seal(obj, key) });
export const decryptWithKey = (enc, key) => open(enc, key);
