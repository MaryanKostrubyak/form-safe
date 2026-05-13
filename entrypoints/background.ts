import { defineBackground } from 'wxt/sandbox';
import type { AppMessage } from '../src/lib/messages';
import {
  MessageTypes,
  fail,
  getTabContextFromUrl,
  ok,
  type SiteStatus,
} from '../src/lib/messages';
import {
  cleanupOldDrafts,
  deleteAllDrafts,
  deleteDraft,
  deleteDraftsForOrigin,
  exportDrafts,
  getDrafts,
  getDraftsForCurrentPage,
  getDraftsForOrigin,
  getSettings,
  saveDraft,
  saveSettings,
  updateDraft,
} from '../src/lib/storage';
import { getHostnameFromUrl, isOriginPaused, toggleOriginRule } from '../src/lib/settings';
import type { Draft, TabContext } from '../src/types';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    void cleanupOldDrafts();
    setSidePanelBehavior();
  });

  chrome.runtime.onStartup.addListener(() => {
    void cleanupOldDrafts();
    setSidePanelBehavior();
  });

  chrome.runtime.onMessage.addListener((message: AppMessage, sender, sendResponse) => {
    void handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse(fail(error)));
    return true;
  });
});

async function handleMessage(message: AppMessage, sender: chrome.runtime.MessageSender) {
  switch (message.type) {
    case MessageTypes.GetSettings:
      return ok(await getSettings());
    case MessageTypes.SaveSettings:
      return ok(await saveSettings(message.settings));
    case MessageTypes.SaveDraft:
      return ok(await saveDraft(message.draft));
    case MessageTypes.UpdateDraft:
      return ok(await updateDraft(message.id, message.patch));
    case MessageTypes.GetDrafts:
      return ok(await getDrafts());
    case MessageTypes.GetDraftsForCurrentPage:
      return ok(await getDraftsForCurrentPage(message.origin, message.pathname));
    case MessageTypes.GetDraftsForOrigin:
      return ok(await getDraftsForOrigin(message.origin));
    case MessageTypes.DeleteDraft:
      return ok(await deleteDraft(message.id));
    case MessageTypes.DeleteDraftsForOrigin:
      return ok(await deleteDraftsForOrigin(message.origin));
    case MessageTypes.DeleteAllDrafts:
      return ok(await deleteAllDrafts());
    case MessageTypes.ExportDrafts:
      return ok(await exportDrafts());
    case MessageTypes.CleanupOldDrafts:
      return ok(await cleanupOldDrafts());
    case MessageTypes.OpenSidePanel:
      return ok(await openSidePanel(message.tabId ?? sender.tab?.id));
    case MessageTypes.GetTabContext:
      return ok(await getActiveTabContext());
    case MessageTypes.TogglePauseOrigin:
      return ok(await togglePausedOrigin(message.origin));
    case MessageTypes.GetSiteStatus:
      return ok(await getSiteStatus(message.origin, message.hostname));
    case MessageTypes.RestoreDraftToTab:
      return ok(await restoreDraftToTab(message.draft, message.tabId ?? sender.tab?.id));
    default:
      return fail('Unsupported FormSafe message.');
  }
}

async function openSidePanel(tabId: number | undefined): Promise<boolean> {
  const targetTabId = tabId ?? (await queryTabs({ active: true, currentWindow: true }))[0]?.id;
  if (!targetTabId || !chrome.sidePanel?.open) return false;

  try {
    await chrome.sidePanel.setOptions?.({
      tabId: targetTabId,
      path: 'sidepanel.html',
      enabled: true,
    });
    await chrome.sidePanel.open({ tabId: targetTabId });
    return true;
  } catch {
    return false;
  }
}

async function getActiveTabContext(): Promise<TabContext> {
  const [tab] = await queryTabs({ active: true, currentWindow: true });
  return getTabContextFromUrl(tab?.url, tab?.title ?? '');
}

async function togglePausedOrigin(origin: string): Promise<SiteStatus> {
  const settings = await getSettings();
  const hostname = getHostnameFromUrl(origin);
  const nextSettings = {
    ...settings,
    siteBlacklist: toggleOriginRule(settings.siteBlacklist, origin),
  };
  await saveSettings(nextSettings);
  const drafts = await getDraftsForOrigin(origin);

  return {
    settings: nextSettings,
    isPaused: isOriginPaused(nextSettings, origin, hostname),
    draftCount: drafts.length,
  };
}

async function getSiteStatus(origin: string, hostname: string): Promise<SiteStatus> {
  const settings = await getSettings();
  const drafts = origin ? await getDraftsForOrigin(origin) : [];

  return {
    settings,
    isPaused: isOriginPaused(settings, origin, hostname),
    draftCount: drafts.length,
  };
}

async function restoreDraftToTab(draft: Draft, tabId: number | undefined): Promise<boolean> {
  const targetTabId = tabId ?? (await queryTabs({ active: true, currentWindow: true }))[0]?.id;
  if (!targetTabId) return false;

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      targetTabId,
      { type: MessageTypes.ContentRestoreDraft, draft } satisfies AppMessage,
      (response: { ok?: boolean } | undefined) => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve(false);
          return;
        }

        resolve(Boolean(response?.ok));
      },
    );
  });
}

function queryTabs(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve) => {
    chrome.tabs.query(queryInfo, (tabs) => resolve(tabs));
  });
}

function setSidePanelBehavior(): void {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => undefined);
}
