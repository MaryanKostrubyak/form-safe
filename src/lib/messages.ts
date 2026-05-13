import type { Draft, Settings, TabContext } from '../types';

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
  | { type: typeof MessageTypes.ContentRestoreDraft; draft: Draft };

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
