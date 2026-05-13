import type { Draft, Settings } from '../types';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';
import { sortDraftsNewestFirst } from './format';

export const DRAFTS_KEY = 'formsafe:drafts';
export const SETTINGS_KEY = 'formsafe:settings';

type DraftRecord = Record<string, Draft>;

let draftWriteQueue = Promise.resolve();
let extensionContextInvalidated = false;

export async function getSettings(): Promise<Settings> {
  try {
    const result = await storageGet<Record<string, Partial<Settings> | undefined>>(SETTINGS_KEY);
    return normalizeSettings(result[SETTINGS_KEY]);
  } catch (error) {
    logStorageError('getSettings', error);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<boolean> {
  try {
    await storageSet({ [SETTINGS_KEY]: normalizeSettings(settings) });
    return true;
  } catch (error) {
    logStorageError('saveSettings', error);
    return false;
  }
}

export async function saveDraft(draft: Draft): Promise<Draft | null> {
  try {
    return await queueDraftRecordUpdate(async (drafts) => {
      const existing = drafts[draft.id];
      const now = Date.now();
      const next: Draft = {
        ...draft,
        createdAt: existing?.createdAt ?? draft.createdAt ?? now,
        restoreCount: existing?.restoreCount ?? draft.restoreCount ?? 0,
        isArchived: existing?.isArchived ?? draft.isArchived ?? false,
        isFavorite: existing?.isFavorite ?? draft.isFavorite ?? false,
        updatedAt: now,
        lastSavedAt: now,
      };

      drafts[next.id] = next;
      await storageSet({ [DRAFTS_KEY]: drafts });
      return next;
    });
  } catch (error) {
    logStorageError('saveDraft', error);
    return null;
  }
}

export async function updateDraft(id: string, patch: Partial<Draft>): Promise<Draft | null> {
  try {
    return await queueDraftRecordUpdate(async (drafts) => {
      const existing = drafts[id];
      if (!existing) return null;

      const next: Draft = {
        ...existing,
        ...patch,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: patch.updatedAt ?? Date.now(),
      };

      drafts[id] = next;
      await storageSet({ [DRAFTS_KEY]: drafts });
      return next;
    });
  } catch (error) {
    logStorageError('updateDraft', error);
    return null;
  }
}

export async function getDrafts(): Promise<Draft[]> {
  try {
    return sortDraftsNewestFirst(Object.values(await getDraftRecord()));
  } catch (error) {
    logStorageError('getDrafts', error);
    return [];
  }
}

export async function getDraftsForCurrentPage(origin: string, pathname: string): Promise<Draft[]> {
  const drafts = await getDraftsForOrigin(origin);
  return drafts.filter((draft) => draft.pathname === pathname && !draft.isArchived);
}

export async function getDraftsForOrigin(origin: string): Promise<Draft[]> {
  const drafts = await getDrafts();
  return drafts.filter((draft) => draft.origin === origin);
}

export async function deleteDraft(id: string): Promise<boolean> {
  try {
    return await queueDraftRecordUpdate(async (drafts) => {
      delete drafts[id];
      await storageSet({ [DRAFTS_KEY]: drafts });
      return true;
    });
  } catch (error) {
    logStorageError('deleteDraft', error);
    return false;
  }
}

export async function deleteDraftsForOrigin(origin: string): Promise<boolean> {
  try {
    return await queueDraftRecordUpdate(async (drafts) => {
      for (const [id, draft] of Object.entries(drafts)) {
        if (draft.origin === origin) delete drafts[id];
      }
      await storageSet({ [DRAFTS_KEY]: drafts });
      return true;
    });
  } catch (error) {
    logStorageError('deleteDraftsForOrigin', error);
    return false;
  }
}

export async function deleteAllDrafts(): Promise<boolean> {
  try {
    return await queueDraftRecordUpdate(async () => {
      await storageSet({ [DRAFTS_KEY]: {} });
      return true;
    });
  } catch (error) {
    logStorageError('deleteAllDrafts', error);
    return false;
  }
}

export async function exportDrafts(): Promise<string> {
  const payload = {
    exportedAt: new Date().toISOString(),
    settings: await getSettings(),
    drafts: await getDrafts(),
  };

  return JSON.stringify(payload, null, 2);
}

export async function cleanupOldDrafts(): Promise<number> {
  try {
    const settings = await getSettings();
    const cutoff = Date.now() - settings.autoDeleteDays * 24 * 60 * 60 * 1000;
    return await queueDraftRecordUpdate(async (drafts) => {
      let removed = 0;

      for (const [id, draft] of Object.entries(drafts)) {
        if (!draft.isFavorite && draft.updatedAt < cutoff) {
          delete drafts[id];
          removed += 1;
        }
      }

      if (removed > 0) await storageSet({ [DRAFTS_KEY]: drafts });
      return removed;
    });
  } catch (error) {
    logStorageError('cleanupOldDrafts', error);
    return 0;
  }
}

export function hasStorageContextInvalidated(): boolean {
  return extensionContextInvalidated;
}

async function getDraftRecord(): Promise<DraftRecord> {
  const result = await storageGet<Record<string, DraftRecord | undefined>>(DRAFTS_KEY);
  const drafts = result[DRAFTS_KEY];
  return drafts && typeof drafts === 'object' && !Array.isArray(drafts) ? drafts : {};
}

function queueDraftRecordUpdate<T>(operation: (drafts: DraftRecord) => Promise<T>): Promise<T> {
  const run = draftWriteQueue.then(async () => operation(await getDraftRecord()));
  draftWriteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function storageGet<T>(keys: string | string[] | null): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(keys, (result) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(result as T);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(items, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function logStorageError(operation: string, error: unknown): void {
  if (isExtensionContextInvalidated(error)) {
    extensionContextInvalidated = true;
    return;
  }
  console.debug(`[FormSafe] Storage operation failed: ${operation}`, error);
}

function isExtensionContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('extension context invalidated');
}
