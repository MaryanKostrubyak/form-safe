import { describe, expect, it } from 'vitest';
import { createPlainBackup, mergeImportedSessions, parseBackupDocument, parsePlainBackup, previewImportedSessions } from '../src/lib/v2/backup';
import { migrateLegacyDrafts } from '../src/lib/v2/model';
import type { Draft } from '../src/types';

const legacy: Draft = {
  id: 'draft', origin: 'https://example.com', url: 'https://example.com/form', pathname: '/form',
  pageTitle: 'Form', fieldLabel: 'Message', fieldType: 'textarea',
  selectorInfo: { selector: '#message', fallbackSelector: '#message', formSignature: 'form', fieldSignature: 'message' },
  value: 'Saved text', createdAt: 1, updatedAt: 2, lastSavedAt: 2, restoreCount: 0,
  isArchived: false, isFavorite: false,
};

describe('backup validation', () => {
  it('round-trips a schema v2 backup', () => {
    const backup = createPlainBackup(migrateLegacyDrafts([legacy]), { exportedAt: '2026-01-01T00:00:00.000Z' });
    expect(parsePlainBackup(JSON.stringify(backup)).sessions[0]!.fields[0]!.value).toBe('Saved text');
  });

  it('rejects unknown or oversized payloads', () => {
    expect(() => parsePlainBackup('{"schemaVersion":99}')).toThrow();
    expect(() => parsePlainBackup('x'.repeat(52 * 1024 * 1024))).toThrow(/large/i);
  });

  it('previews newer-wins merge conflicts before import', () => {
    const current = migrateLegacyDrafts([legacy])[0]!;
    const older = { ...current, updatedAt: 1 };
    const newer = { ...current, updatedAt: 5 };
    const added = { ...current, id: 'added', updatedAt: 3 };

    expect(previewImportedSessions([current], [older, added])).toEqual({
      imported: 2,
      added: 1,
      updated: 0,
      skipped: 1,
      conflicts: 1,
      totalAfterMerge: 2,
    });
    expect(previewImportedSessions([current], [newer])).toMatchObject({ updated: 1, conflicts: 1 });
  });

  it('validates an encrypted envelope before key derivation', () => {
    expect(parseBackupDocument(JSON.stringify({
      kind: 'formsafe-encrypted-backup', schemaVersion: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      metadata: { version: 1, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA-256', iterations: 600_000, salt: 'c2FsdA==' },
      payload: { version: 1, iv: 'aXY=', ciphertext: 'Y2lwaGVy' },
    })).kind).toBe('formsafe-encrypted-backup');
    expect(() => parseBackupDocument('{"kind":"formsafe-encrypted-backup"}')).toThrow();
    expect(() => parseBackupDocument('not-json')).toThrow(/valid JSON/i);
  });

  it('merges imported sessions by updated time', () => {
    const current = migrateLegacyDrafts([legacy])[0]!;
    const older = { ...current, updatedAt: 1 };
    const newer = { ...current, updatedAt: 3 };
    expect(mergeImportedSessions([current], [older])[0]!.updatedAt).toBe(2);
    expect(mergeImportedSessions([current], [newer])[0]!.updatedAt).toBe(3);
  });
});
