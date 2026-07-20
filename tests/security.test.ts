import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { DraftRepository, FORM_SAFE_DB_NAME } from '../src/lib/v2/repository';
import { migrateLegacyDrafts } from '../src/lib/v2/model';
import {
  changePassphrase,
  disableEncryption,
  enableEncryption,
  getSecurityConfig,
  getSecurityStatus,
  getUnlockedCodec,
  lock,
  lockedSessionCodec,
  unlock,
} from '../src/lib/v2/security';
import type { Draft } from '../src/types';

function storageArea(values: Map<string, unknown>) {
  return {
    async get(key: string) { return { [key]: values.get(key) }; },
    async set(items: Record<string, unknown>) { for (const [key, value] of Object.entries(items)) values.set(key, value); },
    async remove(key: string) { values.delete(key); },
  };
}

function makeSession() {
  const draft: Draft = {
    id: 'secure', origin: 'https://example.com', url: 'https://example.com/form', pathname: '/form',
    pageTitle: 'Secure', fieldLabel: 'Note', fieldType: 'textarea', value: 'private',
    selectorInfo: { selector: '#note', fallbackSelector: '#note', formSignature: 'secure', fieldSignature: 'note' },
    createdAt: 1, updatedAt: 1, lastSavedAt: 1, restoreCount: 0, isArchived: false, isFavorite: false,
  };
  return { ...migrateLegacyDrafts([draft])[0]!, id: 'secure' };
}

let repository: DraftRepository;

beforeEach(() => {
  const local = new Map<string, unknown>();
  const session = new Map<string, unknown>();
  vi.stubGlobal('chrome', { storage: { local: storageArea(local), session: storageArea(session) } });
  repository = new DraftRepository();
});

afterEach(async () => {
  await repository.close();
  await deleteDB(FORM_SAFE_DB_NAME);
  vi.unstubAllGlobals();
});

describe('encryption lifecycle', () => {
  it('uses a fail-closed codec while locked', async () => {
    const codec = lockedSessionCodec();
    await expect(codec.encode(makeSession())).rejects.toThrow(/locked/i);
    await expect(codec.decode({})).rejects.toThrow(/locked/i);
  });

  it('enables, locks, unlocks, rotates and disables encryption without losing sessions', async () => {
    await repository.put(makeSession());
    await expect(getSecurityConfig()).resolves.toEqual({ enabled: false });
    await expect(getSecurityStatus()).resolves.toEqual({ enabled: false, locked: false });

    await enableEncryption(repository, 'original passphrase');
    await expect(getSecurityStatus()).resolves.toEqual({ enabled: true, locked: false });
    await expect(repository.get('secure')).resolves.toMatchObject({ id: 'secure' });

    await lock();
    await expect(getSecurityStatus()).resolves.toEqual({ enabled: true, locked: true });
    await expect(getUnlockedCodec()).rejects.toThrow(/locked/i);
    await expect(unlock('wrong passphrase')).resolves.toBe(false);
    await expect(unlock('original passphrase')).resolves.toBe(true);
    repository.setCodec(await getUnlockedCodec());

    await expect(changePassphrase(repository, 'wrong passphrase', 'replacement passphrase')).resolves.toBe(false);
    await expect(changePassphrase(repository, 'original passphrase', 'replacement passphrase')).resolves.toBe(true);
    await lock();
    await expect(unlock('original passphrase')).resolves.toBe(false);
    await expect(unlock('replacement passphrase')).resolves.toBe(true);
    repository.setCodec(await getUnlockedCodec());

    await expect(disableEncryption(repository, 'wrong passphrase')).resolves.toBe(false);
    await expect(disableEncryption(repository, 'replacement passphrase')).resolves.toBe(true);
    await expect(getSecurityStatus()).resolves.toEqual({ enabled: false, locked: false });
    await expect(repository.get('secure')).resolves.toMatchObject({ fields: [{ value: 'private' }] });
  }, 15_000);
});
