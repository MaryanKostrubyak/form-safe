import type {
  Draft,
  FieldSnapshot,
  FormDraftSession,
  SessionCapture,
  SessionPage,
  SessionQuery,
  Settings,
  StorageStats,
  TabContext,
  VersionReason,
} from '../types';
import type { SecurityStatus } from './v2/security';
import type { BackupPreview } from './v2/backup';
import type { DataChangeScope } from './v2/change-events';

export const MessageTypes = {
  GetSettings: 'formsafe:get-settings',
  SaveSettings: 'formsafe:save-settings',
  SaveDraft: 'formsafe:save-draft',
  UpdateDraft: 'formsafe:update-draft',
  GetDrafts: 'formsafe:get-drafts',
  GetDraftsForCurrentPage: 'formsafe:get-drafts-current-page',
  GetDraftsForOrigin: 'formsafe:get-drafts-origin',
  DeleteDraft: 'formsafe:delete-draft',
  DeleteDraftsForOrigin: 'formsafe:delete-drafts-origin',
  DeleteAllDrafts: 'formsafe:delete-all-drafts',
  ExportDrafts: 'formsafe:export-drafts',
  CleanupOldDrafts: 'formsafe:cleanup-old-drafts',
  OpenSidePanel: 'formsafe:open-side-panel',
  GetTabContext: 'formsafe:get-tab-context',
  TogglePauseOrigin: 'formsafe:toggle-pause-origin',
  GetSiteStatus: 'formsafe:get-site-status',
  RestoreDraftToTab: 'formsafe:restore-draft-to-tab',
  ContentRestoreDraft: 'formsafe:content-restore-draft',
  SaveSession: 'formsafe:v2-save-session',
  QuerySessions: 'formsafe:v2-query-sessions',
  GetSession: 'formsafe:v2-get-session',
  PatchSession: 'formsafe:v2-patch-session',
  CheckpointSession: 'formsafe:v2-checkpoint-session',
  DeleteSession: 'formsafe:v2-delete-session',
  StorageStats: 'formsafe:v2-storage-stats',
  RestoreSession: 'formsafe:v2-restore-session',
  ContentRestoreSession: 'formsafe:v2-content-restore-session',
  ContentRestoreResult: 'formsafe:v2-content-restore-result',
  IgnoreFocusedField: 'formsafe:v2-ignore-focused-field',
  GetSecurityStatus: 'formsafe:v2-security-status',
  EnableEncryption: 'formsafe:v2-enable-encryption',
  DisableEncryption: 'formsafe:v2-disable-encryption',
  ChangePassphrase: 'formsafe:v2-change-passphrase',
  Unlock: 'formsafe:v2-unlock',
  Lock: 'formsafe:v2-lock',
  RequestHostAccess: 'formsafe:v2-request-host-access',
  ConfirmHostAccess: 'formsafe:v2-confirm-host-access',
  GetHostAccess: 'formsafe:v2-get-host-access',
  ExportBackup: 'formsafe:v2-export-backup',
  ImportBackup: 'formsafe:v2-import-backup',
  PreviewImport: 'formsafe:v2-preview-import',
  DataChanged: 'formsafe:v2-data-changed',
} as const;

export type MessageType = (typeof MessageTypes)[keyof typeof MessageTypes];

export type AppMessage =
  | { type: typeof MessageTypes.GetSettings }
  | { type: typeof MessageTypes.SaveSettings; settings: Settings }
  | { type: typeof MessageTypes.SaveDraft; draft: Draft }
  | { type: typeof MessageTypes.UpdateDraft; id: string; patch: Partial<Draft> }
  | { type: typeof MessageTypes.GetDrafts }
  | { type: typeof MessageTypes.GetDraftsForCurrentPage; origin: string; pathname: string }
  | { type: typeof MessageTypes.GetDraftsForOrigin; origin: string }
  | { type: typeof MessageTypes.DeleteDraft; id: string }
  | { type: typeof MessageTypes.DeleteDraftsForOrigin; origin: string }
  | { type: typeof MessageTypes.DeleteAllDrafts }
  | { type: typeof MessageTypes.ExportDrafts }
  | { type: typeof MessageTypes.CleanupOldDrafts }
  | { type: typeof MessageTypes.OpenSidePanel; tabId?: number }
  | { type: typeof MessageTypes.GetTabContext }
  | { type: typeof MessageTypes.TogglePauseOrigin; origin: string }
  | { type: typeof MessageTypes.GetSiteStatus; origin: string; hostname: string }
  | { type: typeof MessageTypes.RestoreDraftToTab; tabId?: number; draft: Draft }
  | { type: typeof MessageTypes.ContentRestoreDraft; draft: Draft }
  | { type: typeof MessageTypes.SaveSession; capture: SessionCapture; reason: 'autosave' | VersionReason }
  | { type: typeof MessageTypes.QuerySessions; query: SessionQuery }
  | { type: typeof MessageTypes.GetSession; id: string }
  | { type: typeof MessageTypes.PatchSession; id: string; patch: Partial<Pick<FormDraftSession, 'status' | 'isFavorite'>> }
  | { type: typeof MessageTypes.CheckpointSession; id: string }
  | { type: typeof MessageTypes.DeleteSession; id: string }
  | { type: typeof MessageTypes.StorageStats }
  | { type: typeof MessageTypes.RestoreSession; id: string; versionId?: string; fieldIds?: string[] }
  | { type: typeof MessageTypes.ContentRestoreSession; requestId: string; sessionId: string; origin: string; pathname: string; formSignature: string; fields: FieldSnapshot[] }
  | { type: typeof MessageTypes.ContentRestoreResult; requestId: string; success: boolean }
  | { type: typeof MessageTypes.IgnoreFocusedField }
  | { type: typeof MessageTypes.GetSecurityStatus }
  | { type: typeof MessageTypes.EnableEncryption; passphrase: string }
  | { type: typeof MessageTypes.DisableEncryption; passphrase: string }
  | { type: typeof MessageTypes.ChangePassphrase; currentPassphrase: string; newPassphrase: string }
  | { type: typeof MessageTypes.Unlock; passphrase: string }
  | { type: typeof MessageTypes.Lock }
  | { type: typeof MessageTypes.RequestHostAccess; origins: string[]; mode: Settings['hostAccessMode'] }
  | { type: typeof MessageTypes.ConfirmHostAccess; mode: Settings['hostAccessMode'] }
  | { type: typeof MessageTypes.GetHostAccess }
  | { type: typeof MessageTypes.ExportBackup; encrypted: boolean; passphrase?: string }
  | { type: typeof MessageTypes.ImportBackup; contents: string; passphrase?: string }
  | { type: typeof MessageTypes.PreviewImport; contents: string; passphrase?: string }
  | { type: typeof MessageTypes.DataChanged; scope?: DataChangeScope };

export interface AppStateSnapshot {
  settings: Settings;
  security: SecurityStatus;
  storage: StorageStats;
}

export type QuerySessionsResponse = SessionPage;
export type ImportPreviewResponse = BackupPreview;

export type MessageResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface SiteStatus {
  settings: Settings;
  isPaused: boolean;
  draftCount: number;
}

export async function sendMessage<T>(message: AppMessage): Promise<MessageResponse<T>> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response: MessageResponse<T> | undefined) => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve({ ok: false, error: error.message ?? 'Chrome runtime message failed.' });
          return;
        }

        resolve(response ?? { ok: false, error: 'No response from FormSafe background service.' });
      });
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : 'Unknown message error.' });
    }
  });
}

export function ok<T>(data: T): MessageResponse<T> {
  return { ok: true, data };
}

export function fail(error: unknown): MessageResponse<never> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function getTabContextFromUrl(url: string | undefined, title = ''): TabContext {
  if (!url) {
    return {
      url: '',
      origin: '',
      pathname: '',
      hostname: '',
      title,
      isSupported: false,
    };
  }

  try {
    const parsed = new URL(url);
    const isSupported = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    return {
      url,
      origin: isSupported ? parsed.origin : '',
      pathname: isSupported ? parsed.pathname : '',
      hostname: isSupported ? parsed.hostname : '',
      title,
      isSupported,
    };
  } catch {
    return {
      url,
      origin: '',
      pathname: '',
      hostname: '',
      title,
      isSupported: false,
    };
  }
}
