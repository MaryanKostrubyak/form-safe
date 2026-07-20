import { defineBackground } from 'wxt/utils/define-background';
import type { AppMessage } from '../src/lib/messages';
import { MessageTypes, fail, getTabContextFromUrl, ok, type SiteStatus } from '../src/lib/messages';
import { getDrafts, getSettings, saveSettings, DRAFTS_KEY } from '../src/lib/storage';
import { getHostnameFromUrl, isOriginPaused, toggleOriginRule } from '../src/lib/settings';
import type { FormDraftSession, Settings, TabContext } from '../src/types';
import { createPlainBackup, mergeImportedSessions, parseBackupDocument, previewImportedSessions, type PlainBackup } from '../src/lib/v2/backup';
import { createEncryptionMetadata, decryptJson, deriveEncryptionKey, encryptJson } from '../src/lib/v2/crypto';
import { applySessionSnapshot, createSessionFromCapture, markSessionCompleted, migrateLegacyDrafts } from '../src/lib/v2/model';
import { ALL_SITES_PATTERN } from '../src/lib/v2/host-access';
import type { DataChangeScope } from '../src/lib/v2/change-events';
import { DraftRepository } from '../src/lib/v2/repository';
import {
  disableEncryption,
  enableEncryption,
  changePassphrase,
  getSecurityConfig,
  getSecurityStatus,
  getUnlockedCodec,
  lock,
  lockedSessionCodec,
  unlock,
} from '../src/lib/v2/security';

const MIGRATION_KEY = 'formsafe:migrated-v2';
const CONTENT_SCRIPT_ID = 'formsafe-runtime-content';
const repository = new DraftRepository();
const pendingRestore = new Map<string, (success: boolean) => void>();
const pendingSubmits = new Map<number, { sessionId: string; submittedAt: number }>();
let readyPromise: Promise<void> | undefined;

export default defineBackground(() => {
  readyPromise = initialize();

  chrome.runtime.onInstalled.addListener((details) => {
    void initialize().then(async () => {
      await createContextMenus();
      if (details.reason === 'install') await chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') });
    });
  });
  chrome.runtime.onStartup.addListener(() => void initialize());
  chrome.permissions?.onAdded?.addListener(() => void syncRuntimeContentScript());
  chrome.permissions?.onRemoved?.addListener(() => void syncRuntimeContentScript());
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) void completePendingSubmitAfterNavigation(tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => pendingSubmits.delete(tabId));
  chrome.commands?.onCommand?.addListener((command) => {
    if (command === 'open-recovery') void openSidePanel(undefined);
    if (command === 'restore-latest') void restoreLatestForActiveTab();
  });
  chrome.contextMenus?.onClicked?.addListener((info, tab) => {
    if (info.menuItemId === 'formsafe-open') void openSidePanel(tab?.id);
    if (info.menuItemId === 'formsafe-restore') void restoreLatestForActiveTab();
    if (info.menuItemId === 'formsafe-ignore-field' && tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: MessageTypes.IgnoreFocusedField } satisfies AppMessage, { frameId: info.frameId }, () => void chrome.runtime.lastError);
    }
  });

  chrome.runtime.onMessage.addListener((message: AppMessage, sender, sendResponse) => {
    void handleMessage(message, sender).then(sendResponse).catch((error) => sendResponse(fail(error)));
    return true;
  });
});

async function initialize(): Promise<void> {
  if (readyPromise) return readyPromise;
  const run = (async () => {
    try {
      await chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
    } catch {
      // Some Chromium builds do not expose this method.
    }
    const security = await getSecurityStatus();
    repository.setCodec(security.locked ? lockedSessionCodec() : await getUnlockedCodec());
    await migrateLegacyStorage();
    await syncRuntimeContentScript();
  })();
  readyPromise = run.catch((error) => {
    readyPromise = undefined;
    throw error;
  });
  return readyPromise;
}

async function handleMessage(message: AppMessage, sender: chrome.runtime.MessageSender) {
  await (readyPromise ?? initialize());
  switch (message.type) {
    case MessageTypes.GetSettings: return ok(await getSettings());
    case MessageTypes.SaveSettings: {
      const saved = await saveSettings(message.settings);
      notifyDataChanged('settings');
      return ok(saved);
    }
    case MessageTypes.GetTabContext: return ok(await getActiveTabContext());
    case MessageTypes.TogglePauseOrigin: return ok(await togglePausedOrigin(message.origin));
    case MessageTypes.GetSiteStatus: return ok(await getSiteStatus(message.origin, message.hostname));
    case MessageTypes.OpenSidePanel: return ok(await openSidePanel(message.tabId ?? sender.tab?.id));
    case MessageTypes.SaveSession: {
      assertCaptureMatchesSender(message.capture.origin, message.capture.frameUrl, sender);
      const existing = await repository.get(message.capture.id);
      const now = Date.now();
      const base = existing ?? createSessionFromCapture(message.capture, now);
      const next = applySessionSnapshot({ ...base, ...message.capture, fields: base.fields }, message.capture.fields, {
        now,
        reason: message.reason,
      });
      await repository.put(next);
      if (message.reason === 'submit' && sender.tab?.id !== undefined) {
        pendingSubmits.set(sender.tab.id, { sessionId: next.id, submittedAt: now });
      }
      await repository.prune();
      notifyDataChanged();
      return ok(next);
    }
    case MessageTypes.QuerySessions: return ok(await repository.query(message.query));
    case MessageTypes.GetSession: return ok(await repository.get(message.id) ?? null);
    case MessageTypes.PatchSession: {
      const current = await repository.get(message.id);
      if (!current) return ok(null);
      const next = message.patch.status === 'completed'
        ? { ...markSessionCompleted(current), ...message.patch }
        : { ...current, ...message.patch, updatedAt: Date.now() };
      await repository.put(next);
      notifyDataChanged();
      return ok(next);
    }
    case MessageTypes.CheckpointSession: {
      const current = await repository.get(message.id);
      if (!current) return ok(null);
      const next = applySessionSnapshot(current, current.fields, { now: Date.now(), reason: 'manual' });
      await repository.put(next);
      notifyDataChanged();
      return ok(next);
    }
    case MessageTypes.DeleteSession: {
      const deleted = await repository.delete(message.id);
      if (deleted) notifyDataChanged();
      return ok(deleted);
    }
    case MessageTypes.DeleteAllDrafts:
      await repository.clear();
      notifyDataChanged();
      return ok(true);
    case MessageTypes.DeleteDraftsForOrigin: {
      const matches = await repository.query({ origin: message.origin, limit: 100 });
      for (const session of matches.items) await repository.delete(session.id);
      notifyDataChanged();
      return ok(true);
    }
    case MessageTypes.StorageStats: return ok(await repository.stats());
    case MessageTypes.RestoreSession: return ok(await restoreSessionToActiveTab(message.id, message.versionId, message.fieldIds));
    case MessageTypes.ContentRestoreResult: {
      pendingRestore.get(message.requestId)?.(message.success);
      pendingRestore.delete(message.requestId);
      return ok(true);
    }
    case MessageTypes.GetSecurityStatus: return ok(await getSecurityStatus());
    case MessageTypes.Unlock: {
      const success = await unlock(message.passphrase);
      if (success) repository.setCodec(await getUnlockedCodec());
      notifyDataChanged('security');
      return ok(success);
    }
    case MessageTypes.Lock:
      await lock();
      repository.setCodec(lockedSessionCodec());
      notifyDataChanged('security');
      return ok(true);
    case MessageTypes.EnableEncryption:
      await enableEncryption(repository, message.passphrase);
      notifyDataChanged('security');
      return ok(true);
    case MessageTypes.DisableEncryption: {
      const disabled = await disableEncryption(repository, message.passphrase);
      notifyDataChanged('security');
      return ok(disabled);
    }
    case MessageTypes.ChangePassphrase: {
      const changed = await changePassphrase(repository, message.currentPassphrase, message.newPassphrase);
      notifyDataChanged('security');
      return ok(changed);
    }
    case MessageTypes.GetHostAccess: return ok(await getHostAccess());
    case MessageTypes.RequestHostAccess: return ok(await requestHostAccess(message.origins, message.mode));
    case MessageTypes.ConfirmHostAccess:
      assertTrustedExtensionPage(sender);
      return ok(await confirmHostAccess(message.mode));
    case MessageTypes.ExportBackup: return ok(await exportBackup(message.encrypted, message.passphrase));
    case MessageTypes.PreviewImport: return ok(await previewImport(message.contents, message.passphrase));
    case MessageTypes.ImportBackup: return ok(await importBackup(message.contents, message.passphrase));
    default: return fail('Unsupported FormSafe message.');
  }
}

async function migrateLegacyStorage(): Promise<void> {
  const marker = await chrome.storage.local.get(MIGRATION_KEY);
  if (marker[MIGRATION_KEY]) return;
  if ((await getSecurityConfig()).enabled) return;
  const legacy = await getDrafts();
  if (legacy.length > 0 && (await repository.stats()).sessions === 0) {
    const sessions = migrateLegacyDrafts(legacy);
    await repository.putMany(sessions);
    const verified = await repository.all();
    if (verified.length !== sessions.length || sessions.some((session) => {
      const restored = verified.find((candidate) => candidate.id === session.id);
      return !restored || restored.fields.length !== session.fields.length || restored.versions[0]?.reason !== 'migration';
    })) throw new Error('Draft migration verification failed.');
    await chrome.storage.local.remove(DRAFTS_KEY);
  }
  await chrome.storage.local.set({ [MIGRATION_KEY]: true });
}

async function getActiveTabContext(): Promise<TabContext> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return {
    ...getTabContextFromUrl(tab?.url, tab?.title ?? ''),
    tabId: tab?.id,
  };
}

async function togglePausedOrigin(origin: string): Promise<SiteStatus> {
  const settings = await getSettings();
  const nextSettings = { ...settings, siteBlacklist: toggleOriginRule(settings.siteBlacklist, origin) };
  await saveSettings(nextSettings);
  notifyDataChanged('settings');
  return getSiteStatus(origin, getHostnameFromUrl(origin), nextSettings);
}

async function getSiteStatus(origin: string, hostname: string, known?: Settings): Promise<SiteStatus> {
  const settings = known ?? await getSettings();
  const page = origin ? await repository.query({ origin, limit: 1 }) : { total: 0 };
  return { settings, isPaused: isOriginPaused(settings, origin, hostname), draftCount: page.total };
}

async function openSidePanel(tabId: number | undefined): Promise<boolean> {
  const target = tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (!target) return false;
  try {
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId: target });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function restoreLatestForActiveTab(): Promise<boolean> {
  const context = await getActiveTabContext();
  if (!context.isSupported) return false;
  const page = await repository.query({ origin: context.origin, pathname: context.pathname, limit: 1 });
  return page.items[0] ? restoreSessionToActiveTab(page.items[0].id) : false;
}

async function completePendingSubmitAfterNavigation(tabId: number): Promise<void> {
  const pending = pendingSubmits.get(tabId);
  if (!pending) return;
  pendingSubmits.delete(tabId);
  if (Date.now() - pending.submittedAt > 30_000) return;
  const session = await repository.get(pending.sessionId);
  if (!session || session.status !== 'submit-pending') return;
  await repository.put(markSessionCompleted(session));
  notifyDataChanged();
}

async function restoreSessionToActiveTab(id: string, versionId?: string, fieldIds?: string[]): Promise<boolean> {
  const session = await repository.get(id);
  if (!session) return false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const context = getTabContextFromUrl(tab?.url, tab?.title ?? '');
  if (!tab?.id || context.origin !== session.origin || context.pathname !== session.pathname) return false;
  const version = versionId ? session.versions.find((item) => item.id === versionId) : undefined;
  const sourceFields = version?.fields ?? session.fields;
  const fields = fieldIds?.length ? sourceFields.filter((field) => fieldIds.includes(field.id)) : sourceFields;
  const checkpointed = applySessionSnapshot(session, session.fields, { now: Date.now(), reason: 'restore' });
  await repository.put(checkpointed);
  const requestId = crypto.randomUUID();
  const result = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pendingRestore.delete(requestId);
      resolve(false);
    }, 2_500);
    pendingRestore.set(requestId, (success) => {
      clearTimeout(timer);
      resolve(success);
    });
  });
  chrome.tabs.sendMessage(tab.id, {
    type: MessageTypes.ContentRestoreSession,
    requestId,
    sessionId: session.id,
    origin: session.origin,
    pathname: session.pathname,
    formSignature: session.formSignature,
    fields,
  } satisfies AppMessage, () => void chrome.runtime.lastError);
  if (await result) {
    await repository.put({ ...checkpointed, restoreCount: checkpointed.restoreCount + 1, updatedAt: Date.now() });
    notifyDataChanged();
    return true;
  }
  return false;
}

async function getHostAccess(): Promise<{ origins: string[]; mode: Settings['hostAccessMode'] }> {
  const permissions = await chrome.permissions.getAll();
  const settings = await getSettings();
  return { origins: permissions.origins ?? [], mode: settings.hostAccessMode };
}

async function requestHostAccess(origins: string[], mode: Settings['hostAccessMode']): Promise<boolean> {
  const requested = origins.filter(
    (origin) =>
      origin === '<all_urls>' ||
      origin === ALL_SITES_PATTERN ||
      /^https?:\/\//.test(origin),
  );
  if (requested.length === 0) return false;
  const granted = await chrome.permissions.request({ origins: requested });
  if (!granted) return false;
  const settings = await getSettings();
  await saveSettings({ ...settings, onboardingComplete: true, hostAccessMode: mode });
  await syncRuntimeContentScript();
  notifyDataChanged('access');
  return true;
}

async function confirmHostAccess(mode: Settings['hostAccessMode']): Promise<boolean> {
  const settings = await getSettings();
  await saveSettings({ ...settings, onboardingComplete: true, hostAccessMode: mode });
  await syncRuntimeContentScript();
  notifyDataChanged('access');
  return true;
}

async function syncRuntimeContentScript(): Promise<void> {
  if (!chrome.scripting?.registerContentScripts) return;
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  if (existing.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  const permissions = await chrome.permissions.getAll();
  const origins = (permissions.origins ?? []).filter((origin) => /^https?:|^\*:\/\//.test(origin) || origin === '<all_urls>');
  if (origins.length === 0) return;
  await chrome.scripting.registerContentScripts([{
    id: CONTENT_SCRIPT_ID,
    js: ['content-scripts/content.js'],
    matches: origins,
    allFrames: true,
    runAt: 'document_idle',
    persistAcrossSessions: true,
  }]);
  await injectContentIntoOpenTabs();
}

async function injectContentIntoOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id === undefined) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['content-scripts/content.js'],
      });
    } catch {
      // Internal pages and tabs outside granted hosts are intentionally skipped.
    }
  }));
}

async function exportBackup(encrypted: boolean, passphrase?: string): Promise<string> {
  const sessions = await repository.all();
  const plain = createPlainBackup(sessions);
  if (!encrypted) return JSON.stringify(plain, null, 2);
  if (!passphrase) throw new Error('A backup passphrase is required.');
  const metadata = createEncryptionMetadata();
  const key = await deriveEncryptionKey(passphrase, metadata);
  return JSON.stringify({
    kind: 'formsafe-encrypted-backup',
    schemaVersion: 2,
    exportedAt: plain.exportedAt,
    metadata,
    payload: await encryptJson(plain, key),
  }, null, 2);
}

async function importBackup(contents: string, passphrase?: string): Promise<{ imported: number; total: number }> {
  const backup = await decodeBackup(contents, passphrase);
  const existing = await repository.all();
  const merged = mergeImportedSessions(existing, backup.sessions as FormDraftSession[]);
  await repository.replaceWithCodec(merged, await getUnlockedCodec());
  await repository.prune();
  notifyDataChanged();
  return { imported: backup.sessions.length, total: merged.length };
}

async function previewImport(contents: string, passphrase?: string) {
  const backup = await decodeBackup(contents, passphrase);
  return previewImportedSessions(await repository.all(), backup.sessions as FormDraftSession[]);
}

async function decodeBackup(contents: string, passphrase?: string): Promise<PlainBackup> {
  const document = parseBackupDocument(contents);
  if (document.kind === 'formsafe-backup') return document;
  if (!passphrase) throw new Error('A backup passphrase is required.');
  try {
    const key = await deriveEncryptionKey(passphrase, document.metadata);
    const decrypted = await decryptJson(document.payload, key);
    return parseBackupDocument(JSON.stringify(decrypted)) as PlainBackup;
  } catch {
    throw new Error('The backup passphrase is incorrect or the file is damaged.');
  }
}

function assertCaptureMatchesSender(origin: string, frameUrl: string, sender: chrome.runtime.MessageSender): void {
  const senderUrl = sender.url ?? frameUrl;
  const parsed = new URL(senderUrl);
  if (parsed.origin !== origin || !/^https?:$/.test(parsed.protocol)) throw new Error('Rejected untrusted session capture.');
}

function assertTrustedExtensionPage(sender: chrome.runtime.MessageSender): void {
  if (!sender.url?.startsWith(chrome.runtime.getURL('/'))) throw new Error('This action is available only from FormSafe pages.');
}

function notifyDataChanged(scope: DataChangeScope = 'sessions'): void {
  chrome.runtime.sendMessage({ type: MessageTypes.DataChanged, scope } satisfies AppMessage, () => void chrome.runtime.lastError);
}

async function createContextMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'formsafe-open', title: 'Open FormSafe recovery', contexts: ['editable', 'page'] });
  chrome.contextMenus.create({ id: 'formsafe-restore', title: 'Restore latest saved form', contexts: ['editable'] });
  chrome.contextMenus.create({ id: 'formsafe-ignore-field', title: 'Never save this field with FormSafe', contexts: ['editable'] });
}
