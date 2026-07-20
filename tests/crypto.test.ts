import { describe, expect, it } from 'vitest';
import {
  createEncryptionMetadata,
  decryptJson,
  deriveEncryptionKey,
  encryptJson,
  exportSessionKey,
  importSessionKey,
} from '../src/lib/v2/crypto';

describe('encrypted records', () => {
  it('rejects passphrases shorter than the minimum', async () => {
    await expect(deriveEncryptionKey('short', createEncryptionMetadata(1_000))).rejects.toThrow(/10 characters/i);
  });

  it('round-trips JSON and uses a unique IV for every record', async () => {
    const metadata = createEncryptionMetadata();
    const key = await deriveEncryptionKey('correct horse battery staple', metadata);
    const first = await encryptJson({ value: 'private draft' }, key);
    const second = await encryptJson({ value: 'private draft' }, key);

    expect(first.iv).not.toBe(second.iv);
    await expect(decryptJson(first, key)).resolves.toEqual({ value: 'private draft' });
  });

  it('fails closed with the wrong passphrase', async () => {
    const metadata = createEncryptionMetadata();
    const correct = await deriveEncryptionKey('correct horse battery staple', metadata);
    const wrong = await deriveEncryptionKey('not the password', metadata);
    const record = await encryptJson({ value: 'private draft' }, correct);

    await expect(decryptJson(record, wrong)).rejects.toThrow();
  });

  it('can restore a key from session-only key material', async () => {
    const metadata = createEncryptionMetadata(1_000);
    const key = await deriveEncryptionKey('correct horse battery staple', metadata);
    const restored = await importSessionKey(await exportSessionKey(key));
    const record = await encryptJson({ value: 'available this browser session' }, key);
    await expect(decryptJson(record, restored)).resolves.toEqual({ value: 'available this browser session' });
  });
});
