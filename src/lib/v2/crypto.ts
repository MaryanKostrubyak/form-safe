export interface EncryptionMetadata {
  version: 1;
  algorithm: 'AES-GCM';
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
}

export interface EncryptedPayload {
  version: 1;
  iv: string;
  ciphertext: string;
}

const DEFAULT_ITERATIONS = 600_000;

export function createEncryptionMetadata(iterations = DEFAULT_ITERATIONS): EncryptionMetadata {
  return {
    version: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations,
    salt: bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),
  };
}

export async function deriveEncryptionKey(passphrase: string, metadata: EncryptionMetadata): Promise<CryptoKey> {
  if (passphrase.length < 10) throw new Error('Passphrase must contain at least 10 characters.');
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: base64ToBytes(metadata.salt),
      iterations: metadata.iterations,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJson(value: unknown, key: CryptoKey): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { version: 1, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptJson<T = unknown>(payload: EncryptedPayload, key: CryptoKey): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export async function exportSessionKey(key: CryptoKey): Promise<string> {
  const bytes = await crypto.subtle.exportKey('raw', key);
  return bytesToBase64(new Uint8Array(bytes));
}

export async function importSessionKey(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64ToBytes(value), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
