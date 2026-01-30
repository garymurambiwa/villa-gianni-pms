// Lightweight, reversible encryption for sensitive fields.
// NOTE: This includes an AES-256-GCM implementation via WebCrypto for secure
//       temporary storage (IV + ciphertext + auth tag). When unavailable,
//       falls back to XOR-based obfuscation.

const env = (import.meta as any).env || {};
const SECRET: string = String(env.VITE_PMS_CRYPTO_KEY || 'dev-secret');

function xorWithSecret(input: string, secret: string): Uint8Array {
  const inputBytes = new TextEncoder().encode(input);
  const secretBytes = new TextEncoder().encode(secret);
  const out = new Uint8Array(inputBytes.length);
  for (let i = 0; i < inputBytes.length; i++) {
    out[i] = inputBytes[i] ^ secretBytes[i % secretBytes.length];
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encryptSensitive(plaintext: string): string {
  if (!plaintext) return '';
  const xored = xorWithSecret(plaintext, SECRET);
  return `XOR:${toBase64(xored)}`;
}

export function decryptSensitive(payload: string): string {
  if (!payload) return '';
  if (!payload.startsWith('XOR:')) return '';
  const b64 = payload.slice(4);
  const xored = fromBase64(b64);
  const secretBytes = new TextEncoder().encode(SECRET);
  const out = new Uint8Array(xored.length);
  for (let i = 0; i < xored.length; i++) out[i] = xored[i] ^ secretBytes[i % secretBytes.length];
  return new TextDecoder().decode(out);
}

export default { encryptSensitive, decryptSensitive };

// === AES-256-GCM helpers (WebCrypto) ===

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function importKeyFromSecret(secret: string): Promise<CryptoKey> {
  const salt = textEncoder.encode('corepms:aes-salt');
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function getRandomBytes(length = 12): Uint8Array {
  const iv = new Uint8Array(length);
  crypto.getRandomValues(iv);
  return iv;
}

function concatBuffers(a: ArrayBuffer, b: ArrayBuffer): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(new Uint8Array(a), 0);
  out.set(new Uint8Array(b), a.byteLength);
  return out;
}

function bufToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function encryptAES256(plaintext: string): Promise<string> {
  if (!plaintext) return '';
  if (!(globalThis.crypto && crypto.subtle)) {
    // Fallback to XOR obfuscation
    return encryptSensitive(plaintext);
  }
  const iv = getRandomBytes(12);
  const key = await importKeyFromSecret(SECRET);
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(plaintext)
  );
  const payload = concatBuffers(iv.buffer, enc);
  return `AESGCM:${bufToBase64(payload.buffer)}`;
}

export async function decryptAES256(token: string): Promise<string> {
  if (!token) return '';
  if (token.startsWith('XOR:')) return decryptSensitive(token);
  if (!token.startsWith('AESGCM:')) return '';
  if (!(globalThis.crypto && crypto.subtle)) return '';
  const b64 = token.slice('AESGCM:'.length);
  const buf = base64ToBuf(b64);
  const all = new Uint8Array(buf);
  const iv = all.slice(0, 12);
  const ciphertext = all.slice(12);
  const key = await importKeyFromSecret(SECRET);
  const dec = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return textDecoder.decode(dec);
}

export const Crypto = {
  encryptSensitive,
  decryptSensitive,
  encryptAES256,
  decryptAES256,
};
