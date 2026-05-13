import { defineContentScript } from 'wxt/sandbox';
import { MessageTypes, type AppMessage } from '../src/lib/messages';
import { formatRelativeTime } from '../src/lib/format';
import { t } from '../src/lib/i18n';
import { getEffectiveTheme } from '../src/lib/preferences';
import {
  deleteDraft,
  getDraftsForCurrentPage,
  getSettings,
  hasStorageContextInvalidated,
  saveDraft,
  SETTINGS_KEY,
  updateDraft,
} from '../src/lib/storage';
import { DEFAULT_SETTINGS, isSiteAllowed, normalizeSettings } from '../src/lib/settings';
import type { Draft, FieldType, LanguageCode, SelectorInfo, Settings } from '../src/types';

const SENSITIVE_AUTOCOMPLETE = new Set([
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'current-password',
  'new-password',
  'one-time-code',
]);

const SENSITIVE_KEYWORDS = [
  'password',
  'pass',
  'card',
  'cvv',
  'cvc',
  'secret',
  'token',
  'api_key',
  'api-key',
  'apikey',
  'auth',
  'otp',
  'private',
];

type SupportedField = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface TrackedField {
  cleanup: () => void;
  timer: number | undefined;
  lastValue: string;
  draftId: string;
  dirty: boolean;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    void new FormSafeContent().start();
  },
});

class FormSafeContent {
  private settings: Settings = DEFAULT_SETTINGS;
  private isAllowed = false;
  private tracked = new Map<SupportedField, TrackedField>();
  private scanTimer: number | undefined;
  private observer: MutationObserver | undefined;
  private navigationTimer: number | undefined;
  private lastUrl = location.href;
  private readonly statusUi = new StatusUi();
  private readonly restoreUi = new RestoreUi((draft) => this.restoreDraft(draft));

  async start(): Promise<void> {
    if (!isSupportedPage()) return;

    this.settings = await getSettings();
    if (hasStorageContextInvalidated()) return;

    this.refreshAllowedState();
    this.installGlobalListeners();
    this.scan();
    await this.showRestoreCandidates();
  }

  private installGlobalListeners(): void {
    this.observer = new MutationObserver(() => this.scheduleScan());
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['aria-hidden', 'class', 'contenteditable', 'disabled', 'hidden', 'readonly', 'style', 'type'],
      childList: true,
      subtree: true,
    });

    document.addEventListener(
      'submit',
      (event) => {
        const form = event.target instanceof HTMLFormElement ? event.target : undefined;
        this.flushFields(form ? this.getFieldsInRoot(form) : [...this.tracked.keys()]);
      },
      true,
    );

    document.addEventListener(
      'reset',
      (event) => {
        const form = event.target instanceof HTMLFormElement ? event.target : undefined;
        this.flushFields(form ? this.getFieldsInRoot(form) : [...this.tracked.keys()]);
        window.setTimeout(() => void this.showRestoreCandidates(), 0);
      },
      true,
    );

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushFields([...this.tracked.keys()]);
    });

    window.addEventListener('beforeunload', () => this.flushFields([...this.tracked.keys()]));
    window.addEventListener('pagehide', () => this.flushFields([...this.tracked.keys()]));

    this.navigationTimer = window.setInterval(() => {
      if (location.href === this.lastUrl) return;
      this.lastUrl = location.href;
      this.tracked.forEach((field) => window.clearTimeout(field.timer));
      this.tracked.clear();
      this.restoreUi.clear();
      this.refreshAllowedState();
      this.scheduleScan();
      void this.showRestoreCandidates();
    }, 1000);

    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
        this.settings = normalizeSettings(changes[SETTINGS_KEY].newValue as Partial<Settings> | undefined);
        this.refreshAllowedState();
        this.restoreUi.setEnabled(this.settings.showRestorePopup && this.isAllowed);
        this.statusUi.setEnabled(this.settings.showSaveStatus && this.isAllowed);
        this.scheduleScan();
      });

      chrome.runtime.onMessage.addListener((message: AppMessage, _sender, sendResponse) => {
        if (message.type !== MessageTypes.ContentRestoreDraft) return;

        void this.restoreDraft(message.draft)
          .then((success) => sendResponse({ ok: success }))
          .catch(() => sendResponse({ ok: false }));
        return true;
      });
    } catch {
      this.shutdown();
    }
  }

  private refreshAllowedState(): void {
    this.isAllowed = isSiteAllowed(this.settings, location.origin, location.hostname);
    this.statusUi.setLanguage(this.settings.language);
    this.statusUi.setTheme(getEffectiveTheme(this.settings.theme));
    this.restoreUi.setTheme(getEffectiveTheme(this.settings.theme));
    this.restoreUi.setEnabled(this.settings.showRestorePopup && this.isAllowed);
    this.statusUi.setEnabled(this.settings.showSaveStatus && this.isAllowed);
  }

  private scheduleScan(): void {
    window.clearTimeout(this.scanTimer);
    this.scanTimer = window.setTimeout(() => this.scan(), 250);
  }

  private scan(): void {
    if (!this.isAllowed) return;

    for (const [field, tracked] of this.tracked.entries()) {
      if (!document.contains(field) || !this.isSupportedField(field)) {
        window.clearTimeout(tracked.timer);
        tracked.cleanup();
        this.tracked.delete(field);
      }
    }

    for (const field of this.getFieldsInRoot(document)) {
      if (!this.tracked.has(field)) this.trackField(field);
    }
  }

  private trackField(field: SupportedField): void {
    const selectorInfo = buildSelectorInfo(field);
    const draftId = buildDraftId(selectorInfo, getFieldType(field));
    const onInput = () => this.scheduleSave(field);
    const onBlur = () => void this.persistField(field);

    field.addEventListener('input', onInput);
    field.addEventListener('change', onInput);
    field.addEventListener('blur', onBlur);

    this.tracked.set(field, {
      cleanup: () => {
        field.removeEventListener('input', onInput);
        field.removeEventListener('change', onInput);
        field.removeEventListener('blur', onBlur);
      },
      timer: undefined,
      lastValue: getFieldValue(field),
      draftId,
      dirty: false,
    });
  }

  private scheduleSave(field: SupportedField): void {
    if (!this.isAllowed) return;

    const tracked = this.tracked.get(field);
    if (!tracked) return;

    const value = getFieldValue(field);
    if (value === tracked.lastValue) return;

    tracked.lastValue = value;
    tracked.dirty = true;
    window.clearTimeout(tracked.timer);

    if (shouldShowStatus(field, value) && this.settings.showSaveStatus) {
      this.statusUi.show(t(this.settings.language, 'savingStatus'), 'saving');
    }

    tracked.timer = window.setTimeout(() => {
      void this.persistField(field);
    }, this.settings.autosaveDelayMs);
  }

  private async persistField(field: SupportedField): Promise<void> {
    if (!this.isAllowed || !document.contains(field) || !this.isSupportedField(field)) return;

    const value = getFieldValue(field);
    const tracked = this.tracked.get(field);
    if (value.trim().length < this.settings.minCharacters) {
      if (tracked?.dirty) {
        await deleteDraft(tracked.draftId);
        tracked.dirty = false;
      }
      if (hasStorageContextInvalidated()) this.shutdown();
      return;
    }

    const selectorInfo = buildSelectorInfo(field);
    const now = Date.now();
    const draft: Draft = {
      id: buildDraftId(selectorInfo, getFieldType(field)),
      origin: location.origin,
      url: location.href,
      pathname: location.pathname,
      pageTitle: document.title || location.hostname,
      fieldLabel: getFieldLabel(field),
      fieldType: getFieldType(field),
      selectorInfo,
      value,
      createdAt: now,
      updatedAt: now,
      lastSavedAt: now,
      restoreCount: 0,
      isArchived: false,
      isFavorite: false,
    };

    const saved = await saveDraft(draft);
    if (hasStorageContextInvalidated()) {
      this.shutdown();
      return;
    }

    if (!saved) {
      this.statusUi.show(t(this.settings.language, 'saveFailed'), 'error');
      return;
    }

    if (tracked) {
      tracked.draftId = saved.id;
      tracked.lastValue = value;
      tracked.dirty = false;
    }

    if (shouldShowStatus(field, value) && this.settings.showSaveStatus) {
      this.statusUi.show(
        t(this.settings.language, 'savedStatus', { time: formatRelativeTime(saved.lastSavedAt, this.settings.language) }),
        'saved',
        saved.lastSavedAt,
      );
    }
  }

  private flushFields(fields: SupportedField[]): void {
    if (!this.isAllowed) return;
    for (const field of fields) {
      const tracked = this.tracked.get(field);
      if (tracked) window.clearTimeout(tracked.timer);
      void this.persistField(field);
    }
  }

  private async showRestoreCandidates(): Promise<void> {
    if (!this.isAllowed || !this.settings.showRestorePopup) {
      this.restoreUi.clear();
      return;
    }

    const drafts = await getDraftsForCurrentPage(location.origin, location.pathname);
    if (hasStorageContextInvalidated()) {
      this.shutdown();
      return;
    }

    const candidates = drafts
      .filter((draft) => draft.value.trim().length >= this.settings.minCharacters)
      .filter((draft) => {
        const field = this.findFieldForDraft(draft);
        return field && getFieldValue(field) !== draft.value;
      })
      .slice(0, 3);

    if (candidates.length > 0) this.restoreUi.show(candidates, this.settings.language);
    else this.restoreUi.clear();
  }

  private async restoreDraft(draft: Draft): Promise<boolean> {
    const field = this.findFieldForDraft(draft);
    if (!field) {
      this.restoreUi.toast(t(this.settings.language, 'fieldNotFound'));
      return false;
    }

    setFieldValue(field, draft.value);
    field.focus();
    this.restoreUi.toast(t(this.settings.language, 'draftInserted'));
    await updateDraft(draft.id, { restoreCount: draft.restoreCount + 1 });
    if (hasStorageContextInvalidated()) {
      this.shutdown();
      return false;
    }
    this.scheduleSave(field);
    return true;
  }

  private findFieldForDraft(draft: Draft): SupportedField | undefined {
    const selector = draft.selectorInfo.selector || draft.selectorInfo.fallbackSelector;
    const bySelector = queryField(selector);
    if (bySelector && this.matchesDraft(bySelector, draft)) return bySelector;

    for (const field of this.getFieldsInRoot(document, true)) {
      if (this.matchesDraft(field, draft)) return field;
    }

    return undefined;
  }

  private matchesDraft(field: SupportedField, draft: Draft): boolean {
    if (getFieldType(field) !== draft.fieldType) return false;

    const selectorInfo = buildSelectorInfo(field);
    return (
      buildDraftId(selectorInfo, getFieldType(field)) === draft.id ||
      selectorInfo.fieldSignature === draft.selectorInfo.fieldSignature ||
      (Boolean(draft.selectorInfo.fieldName) &&
        draft.selectorInfo.fieldName === selectorInfo.fieldName &&
        selectorInfo.formSignature === draft.selectorInfo.formSignature)
    );
  }

  private getFieldsInRoot(root: ParentNode, forRestore = false): SupportedField[] {
    return Array.from(root.querySelectorAll('textarea, input, [contenteditable]'))
      .filter((element): element is SupportedField =>
        this.isSupportedField(element, { includeEmail: forRestore }),
      );
  }

  private isSupportedField(
    element: Element,
    options: { includeEmail?: boolean } = {},
  ): element is SupportedField {
    if (!(element instanceof HTMLElement)) return false;
    if (element.closest('[data-formsafe-ignore="true"]')) return false;
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    if (!isVisibleField(element)) return false;

    if (element instanceof HTMLTextAreaElement) {
      return !element.disabled && !element.readOnly && !hasSensitiveAttributes(element);
    }

    if (element instanceof HTMLInputElement) {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      if (element.disabled || element.readOnly) return false;
      if (['password', 'hidden', 'file'].includes(type)) return false;
      if (hasSensitiveAttributes(element)) return false;
      if (type === 'email') return options.includeEmail || this.settings.saveEmailFields;
      return type === 'text' || type === 'search' || type === '';
    }

    if (this.settings.saveContentEditable && isContentEditableRoot(element)) {
      return !hasSensitiveAttributes(element);
    }

    return false;
  }

  private shutdown(): void {
    this.isAllowed = false;
    window.clearTimeout(this.scanTimer);
    if (this.navigationTimer) window.clearInterval(this.navigationTimer);
    this.observer?.disconnect();

    for (const [field, tracked] of this.tracked.entries()) {
      window.clearTimeout(tracked.timer);
      tracked.cleanup();
      this.tracked.delete(field);
    }

    this.statusUi.setEnabled(false);
    this.restoreUi.setEnabled(false);
  }
}

function isSupportedPage(): boolean {
  return location.protocol === 'http:' || location.protocol === 'https:';
}

function isContentEditableRoot(element: HTMLElement): boolean {
  if (!element.isContentEditable) return false;
  if (element === document.body || element === document.documentElement) return false;
  return !element.parentElement?.closest('[contenteditable]');
}

function isVisibleField(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  return element.getClientRects().length > 0;
}

function getFieldValue(field: SupportedField): string {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) return field.value;
  return field.innerText || field.textContent || '';
}

function setFieldValue(field: SupportedField, value: string): void {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(field, value);
  } else {
    field.textContent = value;
  }

  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function getFieldType(field: SupportedField): FieldType {
  if (field instanceof HTMLTextAreaElement) return 'textarea';
  if (field instanceof HTMLInputElement) {
    const type = (field.getAttribute('type') || 'text').toLowerCase();
    if (type === 'search') return 'search';
    if (type === 'email') return 'email';
    return 'text';
  }
  return 'contenteditable';
}

function buildDraftId(selectorInfo: SelectorInfo, fieldType: FieldType): string {
  return `draft_${hashString(
    [
      location.origin,
      location.pathname,
      selectorInfo.formSignature,
      selectorInfo.fieldSignature,
      selectorInfo.selector || selectorInfo.fallbackSelector,
      fieldType,
    ].join('|'),
  )}`;
}

function buildSelectorInfo(field: SupportedField): SelectorInfo {
  const fallbackSelector = buildCssPath(field);
  const selector = buildStableSelector(field) || fallbackSelector;

  return {
    selector,
    fallbackSelector,
    formSignature: buildFormSignature(field),
    fieldSignature: buildFieldSignature(field),
    fieldName: field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.name || undefined : undefined,
    fieldId: field.id || undefined,
    placeholder:
      field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
        ? field.placeholder || undefined
        : field.getAttribute('data-placeholder') || undefined,
  };
}

function buildFormSignature(field: SupportedField): string {
  const form = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.form : field.closest('form');
  if (!form) return 'no-form';

  const formIndex = Array.from(document.forms).indexOf(form);
  const actionPath = safeUrlPath(form.getAttribute('action') || '');
  const parts = [
    form.id ? `id:${form.id}` : '',
    form.getAttribute('name') ? `name:${form.getAttribute('name')}` : '',
    actionPath ? `action:${actionPath}` : '',
    form.getAttribute('method') ? `method:${form.getAttribute('method')}` : '',
  ].filter(Boolean);

  if (parts.length > 0) return parts.join('|');
  return `form-index:${formIndex}`;
}

function buildFieldSignature(field: SupportedField): string {
  const label = getFieldLabel(field);
  const tag = field.tagName.toLowerCase();
  const type = getFieldType(field);
  const name =
    field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
      ? field.name || field.id || field.placeholder
      : field.id || field.getAttribute('aria-label') || field.getAttribute('data-placeholder');

  return [
    tag,
    `type:${type}`,
    name ? `name:${name.trim().toLowerCase()}` : '',
    label ? `label:${label.trim().toLowerCase()}` : '',
  ]
    .filter(Boolean)
    .join('|');
}

function getFieldLabel(field: SupportedField): string {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    if (field.labels?.[0]?.textContent) return compactText(field.labels[0].textContent);
    if (field.getAttribute('aria-label')) return compactText(field.getAttribute('aria-label') || '');
    if (field.placeholder) return field.placeholder;
    if (field.name) return humanize(field.name);
    if (field.id) return humanize(field.id);
  }

  const labelledBy = field.getAttribute('aria-labelledby');
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (label.trim()) return compactText(label);
  }

  if (field.getAttribute('aria-label')) return compactText(field.getAttribute('aria-label') || '');
  if (field.getAttribute('data-placeholder')) return compactText(field.getAttribute('data-placeholder') || '');
  if (field.id) return humanize(field.id);

  return 'Untitled field';
}

function hasSensitiveAttributes(field: HTMLElement): boolean {
  const autocomplete = field.getAttribute('autocomplete')?.toLowerCase().trim();
  if (autocomplete && SENSITIVE_AUTOCOMPLETE.has(autocomplete)) return true;

  const haystack = [
    field.getAttribute('name'),
    field.id,
    field.getAttribute('placeholder'),
    field.getAttribute('aria-label'),
    field.getAttribute('autocomplete'),
    field.getAttribute('data-testid'),
    getFieldLabel(field),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return SENSITIVE_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function shouldShowStatus(field: SupportedField, value: string): boolean {
  if (value.trim().length < 12) return false;
  if (field instanceof HTMLTextAreaElement || isContentEditableRoot(field)) return true;
  return value.trim().length > 120;
}

function queryField(selector: string): SupportedField | undefined {
  if (!selector) return undefined;
  try {
    const element = document.querySelector(selector);
    return element instanceof HTMLElement ? (element as SupportedField) : undefined;
  } catch {
    return undefined;
  }
}

function buildStableSelector(field: SupportedField): string {
  const tag = field.tagName.toLowerCase();
  if (field.id) return `${tag}#${escapeCss(field.id)}`;

  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    if (field.name) return `${tag}[name="${escapeAttribute(field.name)}"]`;
    if (field.placeholder) return `${tag}[placeholder="${escapeAttribute(field.placeholder)}"]`;
  }

  const ariaLabel = field.getAttribute('aria-label');
  if (ariaLabel) return `${tag}[aria-label="${escapeAttribute(ariaLabel)}"]`;
  return '';
}

function buildCssPath(field: SupportedField): string {
  const parts: string[] = [];
  let current: Element | null = field;

  while (current && current !== document.documentElement && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    if (current.id) {
      parts.unshift(`${tag}#${escapeCss(current.id)}`);
      break;
    }

    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;

    const currentTag = current.tagName;
    const siblings = Array.from(parent.children).filter((child) => child.tagName === currentTag);
    const index = siblings.indexOf(current) + 1;
    parts.unshift(`${tag}:nth-of-type(${index})`);
    current = parent;
  }

  return parts.join(' > ');
}

function safeUrlPath(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl, location.href).pathname;
  } catch {
    return rawUrl.split('?')[0] ?? rawUrl;
  }
}

function escapeCss(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function humanize(value: string): string {
  return compactText(value.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

class StatusUi {
  private host: HTMLDivElement | undefined;
  private shadow: ShadowRoot | undefined;
  private status: HTMLDivElement | undefined;
  private enabled = true;
  private language: LanguageCode = 'en';
  private theme: 'light' | 'dark' = 'light';
  private savedAt = 0;
  private timer: number | undefined;
  private hideTimer: number | undefined;

  setLanguage(language: LanguageCode): void {
    this.language = language;
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.theme = theme;
    if (this.status) this.status.dataset.theme = theme;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.hide();
  }

  show(text: string, state: 'saving' | 'saved' | 'error', savedAt = 0): void {
    if (!this.enabled) return;

    this.ensureMounted();
    if (!this.status) return;

    this.savedAt = savedAt;
    this.status.dataset.state = state;
    this.status.dataset.theme = this.theme;
    this.status.textContent = text;
    this.status.hidden = false;

    window.clearTimeout(this.timer);
    window.clearTimeout(this.hideTimer);
    if (state === 'saved') {
      this.timer = window.setTimeout(() => this.updateRelativeSavedTime(), 12_000);
      this.hideTimer = window.setTimeout(() => this.hide(), 8000);
    }
  }

  private updateRelativeSavedTime(): void {
    if (!this.status || !this.savedAt) return;
    if (this.savedAt > 0) {
      this.status.textContent = t(this.language, 'savedStatus', {
        time: formatRelativeTime(this.savedAt, this.language),
      });
      return;
    }
    const seconds = Math.max(1, Math.round((Date.now() - this.savedAt) / 1000));
    this.status.textContent = `Saved ${seconds}s ago`;
  }

  private hide(): void {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.hideTimer);
    if (this.status) this.status.hidden = true;
  }

  private ensureMounted(): void {
    if (this.shadow) return;

    this.host = document.createElement('div');
    this.host.id = 'formsafe-status-host';
    document.documentElement.append(this.host);
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .status {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 2147483647;
          border: 1px solid rgba(15, 111, 185, 0.24);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.96);
          color: #101828;
          box-shadow: 0 10px 28px rgba(16, 24, 40, 0.12);
          font: 500 12px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
          padding: 8px 11px;
          pointer-events: none;
        }
        .status[data-state="saving"] { color: #0f6fb9; }
        .status[data-state="error"] { color: #b42318; border-color: rgba(180, 35, 24, 0.28); }
        .status[data-theme="dark"] {
          border-color: rgba(56, 189, 248, 0.24);
          background: rgba(15, 23, 42, 0.96);
          color: #f8fafc;
          box-shadow: 0 10px 28px rgba(2, 6, 23, 0.32);
        }
        .status[data-theme="dark"][data-state="saving"] { color: #7dd3fc; }
        .status[data-theme="dark"][data-state="error"] { color: #fda4af; border-color: rgba(251, 113, 133, 0.32); }
      </style>
      <div class="status" hidden></div>
    `;
    this.status = this.shadow.querySelector<HTMLDivElement>('.status') ?? undefined;
    if (this.status) this.status.dataset.theme = this.theme;
  }
}

class RestoreUi {
  private host: HTMLDivElement | undefined;
  private shadow: ShadowRoot | undefined;
  private enabled = true;
  private theme: 'light' | 'dark' = 'light';
  private toastTimer: number | undefined;

  constructor(private readonly onRestore: (draft: Draft) => Promise<boolean>) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.theme = theme;
    if (this.host) this.host.dataset.theme = theme;
  }

  show(drafts: Draft[], language: LanguageCode): void {
    if (!this.enabled) return;
    this.ensureMounted();
    if (!this.shadow) return;

    const list = this.shadow.querySelector('.list');
    if (!list) return;
    list.innerHTML = '';

    for (const draft of drafts) {
      const item = document.createElement('article');
      item.className = 'card';
      item.innerHTML = `
        <div class="top">
          <span class="dot"></span>
          <strong>Draft found</strong>
        </div>
        <div class="meta">${escapeHtml(draft.fieldLabel || 'Untitled field')}</div>
        <p class="preview" hidden>${escapeHtml(draft.value.slice(0, 240))}</p>
        <div class="actions">
          <button data-action="restore" type="button">Insert</button>
          <button data-action="preview" type="button">Preview</button>
          <button data-action="dismiss" type="button">Dismiss</button>
        </div>
      `;

      const title = item.querySelector('strong');
      if (title) title.textContent = t(language, 'draftFound');
      const meta = item.querySelector('.meta');
      if (meta) meta.textContent = draft.fieldLabel || t(language, 'untitledField');
      item.querySelector('[data-action="restore"]')?.replaceChildren(t(language, 'insert'));
      item.querySelector('[data-action="preview"]')?.replaceChildren(t(language, 'preview'));
      item.querySelector('[data-action="dismiss"]')?.replaceChildren(t(language, 'dismiss'));

      item.querySelector('[data-action="restore"]')?.addEventListener('click', () => {
        void this.onRestore(draft).then((success) => {
          if (success) item.remove();
        });
      });
      item.querySelector('[data-action="preview"]')?.addEventListener('click', () => {
        const preview = item.querySelector('.preview');
        if (preview instanceof HTMLElement) preview.hidden = !preview.hidden;
      });
      item.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => item.remove());

      list.append(item);
    }
  }

  toast(message: string): void {
    this.ensureMounted();
    const toast = this.shadow?.querySelector('.toast');
    if (!(toast instanceof HTMLElement)) return;
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 1800);
  }

  clear(): void {
    this.shadow?.querySelector('.list')?.replaceChildren();
  }

  private ensureMounted(): void {
    if (this.shadow) return;

    this.host = document.createElement('div');
    this.host.id = 'formsafe-restore-host';
    this.host.dataset.theme = this.theme;
    document.documentElement.append(this.host);
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap {
          position: fixed;
          right: 18px;
          bottom: 62px;
          z-index: 2147483647;
          display: grid;
          gap: 10px;
          width: min(340px, calc(100vw - 36px));
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .list { display: grid; gap: 10px; }
        .card {
          border: 1px solid rgba(15, 111, 185, 0.16);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.98);
          box-shadow: 0 16px 42px rgba(16, 24, 40, 0.14);
          color: #101828;
          padding: 12px;
        }
        :host([data-theme="dark"]) .card {
          border-color: rgba(56, 189, 248, 0.18);
          background: rgba(15, 23, 42, 0.98);
          box-shadow: 0 16px 42px rgba(2, 6, 23, 0.36);
          color: #f8fafc;
        }
        .top { display: flex; align-items: center; gap: 8px; font-size: 13px; }
        .dot { width: 8px; height: 8px; border-radius: 999px; background: #1685d9; box-shadow: 0 0 0 4px rgba(22,133,217,.12); }
        .meta { margin-top: 5px; color: #667085; font-size: 12px; line-height: 1.4; }
        :host([data-theme="dark"]) .meta { color: #94a3b8; }
        .preview {
          margin: 9px 0 0;
          max-height: 84px;
          overflow: auto;
          color: #344054;
          font-size: 12px;
          line-height: 1.45;
          white-space: pre-wrap;
        }
        :host([data-theme="dark"]) .preview { color: #cbd5e1; }
        .actions { display: flex; gap: 6px; margin-top: 10px; }
        button {
          appearance: none;
          border: 1px solid #d0d5dd;
          border-radius: 9px;
          background: #fff;
          color: #344054;
          cursor: pointer;
          font: 600 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;
          padding: 8px 10px;
        }
        button:first-child { border-color: #0f6fb9; background: #0f6fb9; color: white; }
        button:hover { filter: brightness(.98); }
        :host([data-theme="dark"]) button {
          border-color: #334155;
          background: #0f172a;
          color: #e2e8f0;
        }
        :host([data-theme="dark"]) button:first-child { border-color: #1685d9; background: #1685d9; color: white; }
        .toast {
          justify-self: end;
          border-radius: 999px;
          background: #101828;
          color: white;
          box-shadow: 0 10px 28px rgba(16, 24, 40, 0.18);
          font: 600 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;
          padding: 9px 12px;
        }
        :host([data-theme="dark"]) .toast { background: #f8fafc; color: #0f172a; }
      </style>
      <div class="wrap">
        <div class="list"></div>
        <div class="toast" hidden></div>
      </div>
    `;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}
