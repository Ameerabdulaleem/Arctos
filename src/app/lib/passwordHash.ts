// Salted PBKDF2 hashing using the browser's Web Crypto API. Used so locally stored accounts never
// hold a plaintext password. This is device local storage, not a replacement for a real server.

const ITERATIONS = 310_000;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

export interface PasswordRecord {
  salt: string;
  hash: string;
  iterations: number;
}

export async function hashPassword(password: string, iterations = ITERATIONS): Promise<PasswordRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return { salt: toBase64(salt), hash: toBase64(hash), iterations };
}

/** Constant time comparison of two equal length byte arrays. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  try {
    const hash = await derive(password, fromBase64(record.salt), record.iterations);
    return timingSafeEqual(hash, fromBase64(record.hash));
  } catch {
    return false;
  }
}
