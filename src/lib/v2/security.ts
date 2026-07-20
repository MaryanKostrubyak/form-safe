import type { FormDraftSession } from '../../types';
import {
  createEncryptionMetadata,
  decryptJson,
  deriveEncryptionKey,
  encryptJson,
  exportSessionKey,
  importSessionKey,
  type EncryptedPayload,
  type EncryptionMetadata,
} from './crypto';
import type { DraftRepository, SessionCodec } from './repository';

export const SECURITY_KEY = 'formsafe:security-v2';
export const SESSION_KEY = 'formsafe:session-key-v2';

export interface SecurityConfig {
  enabled: boolean;
  metadata?: EncryptionMetadata;
  verifier?: EncryptedPayload;
}

export interface SecurityStatus {
  enabled: boolean;
  locked: boolean;
}

export async function getSecurityConfig(): Promise<SecurityConfig> {
  const value = await storageGet<SecurityConfig | undefined>('local', SECURITY_KEY);
  return value ?? { enabled: false };
}

export async function getSecurityStatus(): Promise<SecurityStatus> {
  const config = await getSecurityConfig();
  if (!config.enabled) return { enabled: false, locked: false };
  return { enabled: true, locked: !(await storageGet<string | undefined>('session', SESSION_KEY)) };
}

export async function getUnlockedCodec(): Promise<SessionCodec> {
  const config = await getSecurityConfig();
  if (!config.enabled) return plainSessionCodec();
  const rawKey = await storageGet<string | undefined>('session', SESSION_KEY);
  if (!rawKey) throw new Error('FormSafe is locked.');
  return encryptedSessionCodec(await importSessionKey(rawKey));
}

export async function unlock(passphrase: string): Promise<boolean> {
  const config = await getSecurityConfig();
  if (!config.enabled || !config.metadata || !config.verifier) return false;
  try {
    const key = await deriveEncryptionKey(passphrase, config.metadata);
    const value = await decryptJson<{ marker: string }>(config.verifier, key);
    if (value.marker !== 'formsafe-v2') return false;
    await storageSet('session', SESSION_KEY, await exportSessionKey(key));
    return true;
  } catch {
    return false;
  }
}

export async function lock(): Promise<void> {
  await storageRemove('session', SESSION_KEY);
}

export async function enableEncryption(repository: DraftRepository, passphrase: string): Promise<void> {
  const metadata = createEncryptionMetadata();
  const key = await deriveEncryptionKey(passphrase, metadata);
  const sessions = await repository.all();
  const encryptedCodec = encryptedSessionCodec(key);
  await repository.replaceWithCodec(sessions, encryptedCodec);
  await storageSet('local', SECURITY_KEY, {
    enabled: true,
    metadata,
    verifier: await encryptJson({ marker: 'formsafe-v2' }, key),
  } satisfies SecurityConfig);
  await storageSet('session', SESSION_KEY, await exportSessionKey(key));
}

export async function disableEncryption(repository: DraftRepository, passphrase: string): Promise<boolean> {
  if (!(await unlock(passphrase))) return false;
  repository.setCodec(await getUnlockedCodec());
  const sessions = await repository.all();
  await repository.replaceWithCodec(sessions, plainSessionCodec());
  await storageSet('local', SECURITY_KEY, { enabled: false } satisfies SecurityConfig);
  await lock();
  return true;
}

export async function changePassphrase(
  repository: DraftRepository,
  currentPassphrase: string,
  newPassphrase: string,
): Promise<boolean> {
  if (!(await unlock(currentPassphrase))) return false;
  repository.setCodec(await getUnlockedCodec());
  const sessions = await repository.all();
  const metadata = createEncryptionMetadata();
  const key = await deriveEncryptionKey(newPassphrase, metadata);
  await repository.replaceWithCodec(sessions, encryptedSessionCodec(key));
  await storageSet('local', SECURITY_KEY, {
    enabled: true,
    metadata,
    verifier: await encryptJson({ marker: 'formsafe-v2' }, key),
  } satisfies SecurityConfig);
  await storageSet('session', SESSION_KEY, await exportSessionKey(key));
  return true;
}

export function plainSessionCodec(): SessionCodec {
  return {
    encrypted: false,
    async encode(session) { return session; },
    async decode(payload) { return payload as FormDraftSession; },
  };
}

export function encryptedSessionCodec(key: CryptoKey): SessionCodec {
  return {
    encrypted: true,
    async encode(session) { return encryptJson(session, key); },
    async decode(payload) { return decryptJson<FormDraftSession>(payload as EncryptedPayload, key); },
  };
}

export function lockedSessionCodec(): SessionCodec {
  const reject = async (): Promise<never> => { throw new Error('FormSafe is locked.'); };
  return { encrypted: true, encode: reject, decode: reject };
}

async function storageGet<T>(area: 'local' | 'session', key: string): Promise<T> {
  const result = await chrome.storage[area].get(key);
  return result[key] as T;
}

async function storageSet(area: 'local' | 'session', key: string, value: unknown): Promise<void> {
  await chrome.storage[area].set({ [key]: value });
}

async function storageRemove(area: 'local' | 'session', key: string): Promise<void> {
  await chrome.storage[area].remove(key);
}
