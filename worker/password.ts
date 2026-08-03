const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_BYTES = 32;

export interface PasswordHash {
  readonly salt: string;
  readonly hash: string;
  readonly iterations: number;
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return {
    salt: base64Url(salt),
    hash: base64Url(await derivePassword(password, salt, PASSWORD_ITERATIONS)),
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
  iterations: number,
): Promise<boolean> {
  const actual = await derivePassword(password, fromBase64Url(salt), iterations);
  const expected = fromBase64Url(expectedHash);
  if (expected.byteLength !== actual.byteLength) return false;
  return crypto.subtle.timingSafeEqual(actual, expected);
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    PASSWORD_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
