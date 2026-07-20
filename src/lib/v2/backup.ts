import { z } from 'zod';
import type { FormDraftSession } from '../../types';

export const MAX_BACKUP_BYTES = 51 * 1024 * 1024;

const selectorSchema = z.object({
  selector: z.string().max(10_000),
  fallbackSelector: z.string().max(10_000),
  formSignature: z.string().max(10_000),
  fieldSignature: z.string().max(10_000),
  fieldName: z.string().max(2_000).optional(),
  fieldId: z.string().max(2_000).optional(),
  placeholder: z.string().max(10_000).optional(),
});
const fieldSchema = z.object({
  id: z.string().min(1).max(256),
  label: z.string().max(10_000),
  type: z.enum(['textarea', 'text', 'search', 'email', 'contenteditable', 'select', 'checkbox', 'radio']),
  value: z.union([z.string().max(5_000_000), z.boolean(), z.array(z.string().max(100_000)).max(10_000)]),
  selectorInfo: selectorSchema,
  ignored: z.boolean().optional(),
});
const versionSchema = z.object({
  id: z.string().min(1).max(256),
  createdAt: z.number().finite().nonnegative(),
  reason: z.enum(['migration', 'idle', 'clear', 'restore', 'submit', 'pagehide', 'manual']),
  fields: z.array(fieldSchema).max(1_000),
});
const sessionSchema = z.object({
  id: z.string().min(1).max(256),
  schemaVersion: z.literal(2),
  origin: z.string().url().max(10_000),
  url: z.string().url().max(50_000),
  pathname: z.string().max(20_000),
  pageTitle: z.string().max(20_000),
  formSignature: z.string().max(10_000),
  frameUrl: z.string().url().max(50_000),
  fields: z.array(fieldSchema).max(1_000),
  versions: z.array(versionSchema).max(10),
  createdAt: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
  lastSavedAt: z.number().finite().nonnegative(),
  pendingSubmitAt: z.number().finite().nonnegative().optional(),
  completedAt: z.number().finite().nonnegative().optional(),
  restoreCount: z.number().int().nonnegative(),
  status: z.enum(['active', 'submit-pending', 'completed', 'archived']),
  isFavorite: z.boolean(),
  approximateBytes: z.number().finite().nonnegative(),
});
const backupSchema = z.object({
  kind: z.literal('formsafe-backup'),
  schemaVersion: z.literal(2),
  exportedAt: z.string().datetime(),
  encrypted: z.literal(false),
  sessions: z.array(sessionSchema).max(2_000),
});

const encryptedBackupSchema = z.object({
  kind: z.literal('formsafe-encrypted-backup'),
  schemaVersion: z.literal(2),
  exportedAt: z.string().datetime(),
  metadata: z.object({
    version: z.literal(1),
    algorithm: z.literal('AES-GCM'),
    kdf: z.literal('PBKDF2-SHA-256'),
    iterations: z.number().int().min(100_000).max(5_000_000),
    salt: z.string().min(8).max(1_000),
  }),
  payload: z.object({
    version: z.literal(1),
    iv: z.string().min(4).max(1_000),
    ciphertext: z.string().min(1).max(75_000_000),
  }),
});

export type PlainBackup = z.infer<typeof backupSchema>;
export type EncryptedBackup = z.infer<typeof encryptedBackupSchema>;

export interface BackupPreview {
  imported: number;
  added: number;
  updated: number;
  skipped: number;
  conflicts: number;
  totalAfterMerge: number;
}

export function createPlainBackup(
  sessions: FormDraftSession[],
  options: { exportedAt?: string } = {},
): PlainBackup {
  return backupSchema.parse({
    kind: 'formsafe-backup',
    schemaVersion: 2,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    encrypted: false,
    sessions,
  });
}

export function parsePlainBackup(value: string): PlainBackup {
  const parsed = parseJsonDocument(value);
  return backupSchema.parse(parsed);
}

export function parseBackupDocument(value: string): PlainBackup | EncryptedBackup {
  const parsed = parseJsonDocument(value);
  const kind = typeof parsed === 'object' && parsed !== null && 'kind' in parsed ? parsed.kind : undefined;
  return kind === 'formsafe-encrypted-backup' ? encryptedBackupSchema.parse(parsed) : backupSchema.parse(parsed);
}

export function previewImportedSessions(
  existing: FormDraftSession[],
  imported: FormDraftSession[],
): BackupPreview {
  const current = new Map(existing.map((session) => [session.id, session]));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let conflicts = 0;
  for (const session of imported) {
    const match = current.get(session.id);
    if (!match) {
      added += 1;
      current.set(session.id, session);
      continue;
    }
    conflicts += 1;
    if (session.updatedAt > match.updatedAt) {
      updated += 1;
      current.set(session.id, session);
    } else {
      skipped += 1;
    }
  }
  return { imported: imported.length, added, updated, skipped, conflicts, totalAfterMerge: current.size };
}

export function mergeImportedSessions(
  existing: FormDraftSession[],
  imported: FormDraftSession[],
): FormDraftSession[] {
  const merged = new Map(existing.map((session) => [session.id, session]));
  for (const session of imported) {
    const current = merged.get(session.id);
    if (!current || session.updatedAt > current.updatedAt) merged.set(session.id, session);
  }
  return [...merged.values()];
}

function parseJsonDocument(value: string): unknown {
  if (new TextEncoder().encode(value).byteLength > MAX_BACKUP_BYTES) throw new Error('Backup file is too large.');
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('Backup is not valid JSON.');
  }
}
