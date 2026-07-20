import { defineContentScript } from 'wxt/utils/define-content-script';
import { MessageTypes, sendMessage, type AppMessage } from '../src/lib/messages';
import { isSiteAllowed } from '../src/lib/settings';
import type {
  FieldSnapshot,
  FieldType,
  FieldValue,
  FormDraftSession,
  SelectorInfo,
  SessionCapture,
  SessionPage,
  Settings,
  VersionReason,
} from '../src/types';
import { isSensitiveDescriptor, isSensitiveForm, type SensitiveDescriptor } from '../src/lib/v2/sensitive';
import { shouldReloadContentSettings } from '../src/lib/v2/change-events';

type SupportedField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement;
const contentRuntime = globalThis as typeof globalThis & {
  __formsafeV2ContentActive?: boolean;
};

export default defineContentScript({
  registration: 'runtime',
  allFrames: true,
  runAt: 'document_idle',
  main() {
    if (contentRuntime.__formsafeV2ContentActive) return;
    contentRuntime.__formsafeV2ContentActive = true;
    void new FormSafeContent().start();
  },
});

class FormSafeContent {
  private settings?: Settings;
  private controller = new AbortController();
  private observers: MutationObserver[] = [];
  private observedRoots = new WeakSet<Document | ShadowRoot>();
  private timers = new Map<string, number>();
  private lastValues = new WeakMap<SupportedField, FieldValue>();
  private lastCheckpoint = new Map<string, number>();
  private scanTimer?: number;
  private lastUrl = location.href;
  private pendingSubmit = new Map<string, number>();
  private navigationTimer?: number;
  private messageListenerInstalled = false;
  private readonly ui = new ContentUi();

  async start(): Promise<void> {
    if (!/^https?:$/.test(location.protocol)) return;
    const response = await sendMessage<Settings>({ type: MessageTypes.GetSettings });
    if (!response.ok) return;
    this.settings = response.data;
    if (!this.isAllowed()) return;
    this.install();
    this.scan();
    await this.refreshRestoreCandidate(document.activeElement);
  }

  private install(): void {
    this.observeRoot(document);
    document.addEventListener('submit', (event) => this.onSubmit(event), { capture: true, signal: this.controller.signal });
    document.addEventListener('focusin', (event) => void this.refreshRestoreCandidate(event.target), { signal: this.controller.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flushAll('pagehide');
    }, { signal: this.controller.signal });
    window.addEventListener('pagehide', () => void this.flushAll('pagehide'), { signal: this.controller.signal });
    this.navigationTimer ??= window.setInterval(() => this.checkNavigation(), 750);
    if (!this.messageListenerInstalled) {
      this.messageListenerInstalled = true;
      chrome.runtime.onMessage.addListener((message: AppMessage, _sender, sendResponse) => {
        if (message.type === MessageTypes.DataChanged) {
          if (shouldReloadContentSettings(message.scope)) void this.reloadSettings();
          return undefined;
        }
        if (message.type === MessageTypes.IgnoreFocusedField) {
          void this.ignoreFocusedField().then(sendResponse);
          return true;
        }
        if (message.type !== MessageTypes.ContentRestoreSession) return undefined;
        void this.restore(message);
        return undefined;
      });
    }
  }

  private observeRoot(root: Document | ShadowRoot): void {
    if (this.observedRoots.has(root)) return;
    this.observedRoots.add(root);
    const observer = new MutationObserver(() => this.scheduleScan());
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable', 'disabled', 'hidden', 'readonly', 'type'] });
    this.observers.push(observer);
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) this.observeRoot(element.shadowRoot);
    }
  }

  private scheduleScan(): void {
    clearTimeout(this.scanTimer);
    this.scanTimer = window.setTimeout(() => this.scan(), 180);
  }

  private scan(): void {
    if (!this.isAllowed()) return;
    for (const root of collectRoots(document)) {
      this.observeRoot(root);
      for (const field of collectCandidateFields(root)) this.track(field);
    }
  }

  private track(field: SupportedField): void {
    if (field.dataset.formsafeTracked === 'true' || !this.isSupportedField(field)) return;
    field.dataset.formsafeTracked = 'true';
    this.lastValues.set(field, getFieldValue(field));
    const formSignature = buildFormSignature(field);
    if (!this.lastCheckpoint.has(formSignature)) this.lastCheckpoint.set(formSignature, Date.now());
    const onChange = () => {
      const previous = this.lastValues.get(field);
      const next = getFieldValue(field);
      this.lastValues.set(field, next);
      const reason: 'autosave' | VersionReason = hasValue(previous) && !hasValue(next) ? 'clear' : 'autosave';
      this.scheduleFormSave(field, reason);
    };
    field.addEventListener('input', onChange, { signal: this.controller.signal });
    field.addEventListener('change', onChange, { signal: this.controller.signal });
    field.addEventListener('blur', () => void this.saveForm(field, 'autosave'), { signal: this.controller.signal });
  }

  private scheduleFormSave(field: SupportedField, reason: 'autosave' | VersionReason): void {
    if (!this.settings) return;
    const signature = buildFormSignature(field);
    clearTimeout(this.timers.get(signature));
    if (this.settings.showSaveStatus) this.ui.showStatus('Saving…', 'saving');
    const lastCheckpoint = this.lastCheckpoint.get(signature) ?? 0;
    const effectiveReason = reason === 'autosave' && Date.now() - lastCheckpoint >= 10 * 60_000 ? 'idle' : reason;
    this.timers.set(signature, window.setTimeout(() => void this.saveForm(field, effectiveReason), this.settings.autosaveDelayMs));
  }

  private async saveForm(field: SupportedField, reason: 'autosave' | VersionReason): Promise<FormDraftSession | null> {
    if (!this.settings || !this.isAllowed() || !document.contains(field) && !field.getRootNode()) return null;
    const formFields = this.getFormFields(field);
    if (formFields.length === 0) {
      if (this.settings.showSaveStatus) this.ui.showStatus('Nothing eligible to save', 'error');
      return null;
    }
    if (isSensitiveForm(this.getFormDescriptors(field))) {
      if (this.settings.showSaveStatus) this.ui.showStatus('Not saved: sensitive form', 'error');
      return null;
    }
    const fields = formFields.map(buildFieldSnapshot).filter((snapshot) => {
      if (snapshot.type === 'checkbox' || snapshot.type === 'radio' || snapshot.type === 'select') return this.settings?.saveSafeControls;
      if (snapshot.type === 'email') return this.settings?.saveEmailFields;
      return snapshot.type !== 'contenteditable' || this.settings?.saveContentEditable;
    });
    if (!fields.some((item) => hasValue(item.value) && (typeof item.value !== 'string' || item.value.trim().length >= this.settings!.minCharacters))) {
      if (this.settings.showSaveStatus) this.ui.showStatus('Keep typing to save', 'saving');
      return null;
    }
    const formSignature = buildFormSignature(field);
    const capture: SessionCapture = {
      id: buildSessionId(formSignature),
      origin: location.origin,
      url: location.href,
      pathname: location.pathname,
      pageTitle: document.title || location.hostname,
      formSignature,
      frameUrl: location.href,
      fields,
    };
    const response = await sendMessage<FormDraftSession>({ type: MessageTypes.SaveSession, capture, reason });
    if (!response.ok) {
      if (this.settings.showSaveStatus) this.ui.showStatus(response.error.includes('locked') ? 'FormSafe is locked' : 'Could not save', 'error');
      return null;
    }
    if (reason !== 'autosave') this.lastCheckpoint.set(formSignature, Date.now());
    if (this.settings.showSaveStatus) this.ui.showStatus('Saved locally', 'saved');
    return response.data;
  }

  private async flushAll(reason: VersionReason): Promise<void> {
    const representative = new Map<string, SupportedField>();
    for (const root of collectRoots(document)) {
      for (const field of collectCandidateFields(root)) {
        if (this.isSupportedField(field)) representative.set(buildFormSignature(field), field);
      }
    }
    await Promise.all([...representative.values()].map((field) => this.saveForm(field, reason)));
  }

  private onSubmit(event: Event): void {
    const form = event.target instanceof HTMLFormElement ? event.target : undefined;
    const field = form ? this.getFormFieldsFromRoot(form)[0] : undefined;
    if (!field) return;
    void this.saveForm(field, 'submit').then((session) => {
      if (session) this.pendingSubmit.set(session.id, Date.now());
    });
  }

  private checkNavigation(): void {
    if (location.href === this.lastUrl) return;
    const now = Date.now();
    for (const [id, submittedAt] of this.pendingSubmit) {
      if (now - submittedAt <= 30_000) {
        void sendMessage({ type: MessageTypes.PatchSession, id, patch: { status: 'completed' } });
      }
    }
    this.pendingSubmit.clear();
    this.lastUrl = location.href;
    this.resetTracking();
    this.install();
    this.scan();
  }

  private resetTracking(): void {
    this.controller.abort();
    this.controller = new AbortController();
    for (const observer of this.observers) observer.disconnect();
    this.observers = [];
    this.observedRoots = new WeakSet<Document | ShadowRoot>();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const root of collectRoots(document)) {
      for (const element of root.querySelectorAll<HTMLElement>('[data-formsafe-tracked="true"]')) delete element.dataset.formsafeTracked;
    }
    this.ui.hideRestore();
  }

  private async refreshRestoreCandidate(target: EventTarget | null): Promise<void> {
    if (!this.settings?.showRestorePopup) { this.ui.hideRestore(); return; }
    if (!(target instanceof HTMLElement) || !this.isSupportedField(target)) {
      this.ui.hideRestore();
      return;
    }
    const response = await sendMessage<SessionPage>({
      type: MessageTypes.QuerySessions,
      query: { origin: location.origin, pathname: location.pathname, limit: 50 },
    });
    if (!response.ok) return;
    const signature = buildFormSignature(target);
    const session = response.data.items.find((item) => item.formSignature === signature && item.status !== 'archived');
    if (!session) {
      this.ui.hideRestore();
      return;
    }
    this.ui.showRestore(target, () => void sendMessage({ type: MessageTypes.RestoreSession, id: session.id }));
  }

  private async restore(message: Extract<AppMessage, { type: typeof MessageTypes.ContentRestoreSession }>): Promise<void> {
    if (message.origin !== location.origin || message.pathname !== location.pathname) return;
    const allFields = collectRoots(document).flatMap((root) => collectCandidateFields(root)).filter((field) => this.isSupportedField(field));
    const formFields = allFields.filter((field) => buildFormSignature(field) === message.formSignature);
    if (formFields.length === 0) return;
    let restored = 0;
    for (const snapshot of message.fields) {
      const field = findField(snapshot, formFields);
      if (!field || !this.isSupportedField(field)) continue;
      setFieldValue(field, snapshot.value);
      restored += 1;
    }
    if (restored > 0) this.ui.showStatus(`Restored ${restored} field${restored === 1 ? '' : 's'}`, 'saved');
    await sendMessage({ type: MessageTypes.ContentRestoreResult, requestId: message.requestId, success: restored > 0 });
  }

  private getFormFields(field: SupportedField): SupportedField[] {
    const root = getFormRoot(field);
    return this.getFormFieldsFromRoot(root);
  }

  private getFormFieldsFromRoot(root: ParentNode): SupportedField[] {
    return collectCandidateFields(root).filter((field) => this.isSupportedField(field));
  }

  private getFormDescriptors(field: SupportedField): SensitiveDescriptor[] {
    return collectCandidateFields(getFormRoot(field), true).map(describeField);
  }

  private isSupportedField(field: Element): field is SupportedField {
    if (!(field instanceof HTMLElement) || field.closest('[data-formsafe-ignore="true"]')) return false;
    if (field.hidden || field.getAttribute('aria-hidden') === 'true' || !isVisible(field)) return false;
    if (isSensitiveDescriptor(describeField(field))) return false;
    if (this.settings?.ignoredFieldRules.includes(buildFieldRule(field))) return false;
    if (field instanceof HTMLTextAreaElement) return !field.disabled && !field.readOnly;
    if (field instanceof HTMLSelectElement) return !field.disabled;
    if (field instanceof HTMLInputElement) {
      const type = (field.type || 'text').toLowerCase();
      return !field.disabled && !field.readOnly && ['text', 'search', 'email', 'checkbox', 'radio'].includes(type);
    }
    return isEditableRoot(field);
  }

  private isAllowed(): boolean {
    return Boolean(this.settings && isSiteAllowed(this.settings, location.origin, location.hostname));
  }

  private async reloadSettings(): Promise<void> {
    const response = await sendMessage<Settings>({ type: MessageTypes.GetSettings });
    if (!response.ok) return;
    this.settings = response.data;
    this.resetTracking();
    if (this.isAllowed()) {
      this.install();
      this.scan();
    }
  }

  private async ignoreFocusedField(): Promise<boolean> {
    const field = document.activeElement;
    if (!this.settings || !(field instanceof HTMLElement) || !this.isSupportedField(field)) return false;
    const rule = buildFieldRule(field);
    const settings = { ...this.settings, ignoredFieldRules: [...new Set([...this.settings.ignoredFieldRules, rule])] };
    const result = await sendMessage<boolean>({ type: MessageTypes.SaveSettings, settings });
    if (!result.ok) return false;
    this.settings = settings;
    field.dataset.formsafeIgnore = 'true';
    this.ui.hideRestore();
    if (this.settings.showSaveStatus) this.ui.showStatus('Field ignored', 'saved');
    return true;
  }
}

function collectRoots(root: Document | ShadowRoot): Array<Document | ShadowRoot> {
  const roots: Array<Document | ShadowRoot> = [root];
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) roots.push(...collectRoots(element.shadowRoot));
  }
  return roots;
}

function collectCandidateFields(root: ParentNode, includeSensitive = false): SupportedField[] {
  const selector = includeSensitive ? 'textarea, input, select, [contenteditable="true"], .ProseMirror, .ql-editor, [data-lexical-editor="true"], .cm-content' : 'textarea, input, select, [contenteditable="true"], .ProseMirror, .ql-editor, [data-lexical-editor="true"], .cm-content';
  return Array.from(root.querySelectorAll(selector)).filter((item): item is SupportedField => item instanceof HTMLElement);
}

function getFormRoot(field: SupportedField): ParentNode {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) return field.form ?? field.getRootNode() as ParentNode;
  return field.closest('form') ?? field.getRootNode() as ParentNode;
}

function buildFieldSnapshot(field: SupportedField): FieldSnapshot {
  const selectorInfo = buildSelectorInfo(field);
  return {
    id: `field_${hashString(selectorInfo.fieldSignature)}`,
    label: getFieldLabel(field),
    type: getFieldType(field),
    value: getFieldValue(field),
    selectorInfo,
  };
}

function buildSelectorInfo(field: SupportedField): SelectorInfo {
  const fallbackSelector = buildCssPath(field);
  const selector = buildStableSelector(field) || fallbackSelector;
  return {
    selector,
    fallbackSelector,
    formSignature: buildFormSignature(field),
    fieldSignature: buildFieldSignature(field),
    fieldName: 'name' in field ? String(field.name || '') || undefined : undefined,
    fieldId: field.id || undefined,
    placeholder: 'placeholder' in field ? String(field.placeholder || '') || undefined : field.getAttribute('data-placeholder') ?? undefined,
  };
}

function buildFormSignature(field: SupportedField): string {
  const form = field.closest('form');
  if (form) {
    const parts = [form.id && `id:${form.id}`, form.getAttribute('name') && `name:${form.getAttribute('name')}`, form.getAttribute('action') && `action:${safePath(form.getAttribute('action')!)}`].filter(Boolean);
    if (parts.length > 0) return parts.join('|');
    return `form:${Array.from(document.forms).indexOf(form)}`;
  }
  const root = field.getRootNode();
  if (root instanceof ShadowRoot) return `shadow:${buildCssPath(root.host)}|${getFieldLabel(field).toLowerCase()}`;
  return `page:${location.pathname}|${getFieldLabel(field).toLowerCase()}`;
}

function buildFieldSignature(field: SupportedField): string {
  const name = 'name' in field ? String(field.name || '') : '';
  return [field.tagName.toLowerCase(), getFieldType(field), name || field.id || getFieldLabel(field)].join('|').toLowerCase();
}

function describeField(field: Element): SensitiveDescriptor {
  const element = field as HTMLElement;
  return {
    type: field instanceof HTMLInputElement ? field.type : undefined,
    name: field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement ? field.name : undefined,
    id: element.id,
    label: getFieldLabel(element),
    placeholder: field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.placeholder : undefined,
    autocomplete: element.getAttribute('autocomplete') ?? undefined,
    testId: element.getAttribute('data-testid') ?? undefined,
  };
}

function getFieldType(field: SupportedField): FieldType {
  if (field instanceof HTMLTextAreaElement) return 'textarea';
  if (field instanceof HTMLSelectElement) return 'select';
  if (field instanceof HTMLInputElement) {
    if (field.type === 'checkbox') return 'checkbox';
    if (field.type === 'radio') return 'radio';
    if (field.type === 'search') return 'search';
    if (field.type === 'email') return 'email';
    return 'text';
  }
  return 'contenteditable';
}

function getFieldValue(field: SupportedField): FieldValue {
  if (field instanceof HTMLInputElement) return field.type === 'checkbox' || field.type === 'radio' ? field.checked : field.value;
  if (field instanceof HTMLSelectElement) return field.multiple ? Array.from(field.selectedOptions).map((option) => option.value) : field.value;
  if (field instanceof HTMLTextAreaElement) return field.value;
  return field.innerText || field.textContent || '';
}

function setFieldValue(field: SupportedField, value: FieldValue): void {
  if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) field.checked = Boolean(value);
  else if (field instanceof HTMLSelectElement) {
    const values = new Set(Array.isArray(value) ? value : [String(value)]);
    for (const option of field.options) option.selected = values.has(option.value);
  } else if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, String(value));
  } else field.textContent = String(value);
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function findField(snapshot: FieldSnapshot, fields: SupportedField[]): SupportedField | undefined {
  for (const selector of [snapshot.selectorInfo.selector, snapshot.selectorInfo.fallbackSelector]) {
    if (!selector) continue;
    for (const field of fields) {
      try { if (field.matches(selector)) return field; } catch { /* Invalid site-provided selector. */ }
    }
  }
  return fields.find((field) => buildFieldSignature(field) === snapshot.selectorInfo.fieldSignature);
}

function getFieldLabel(field: HTMLElement): string {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
    const label = field.labels?.[0]?.textContent;
    if (label?.trim()) return compact(label);
    const placeholder = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.placeholder : '';
    return compact(field.getAttribute('aria-label') || placeholder || field.name || field.id || 'Untitled field');
  }
  return compact(field.getAttribute('aria-label') || field.getAttribute('data-placeholder') || field.id || 'Rich text field');
}

function buildStableSelector(field: SupportedField): string {
  const tag = field.tagName.toLowerCase();
  if (field.id) return `${tag}#${CSS.escape(field.id)}`;
  if ('name' in field && field.name) return `${tag}[name="${escapeAttribute(String(field.name))}"]`;
  const aria = field.getAttribute('aria-label');
  return aria ? `${tag}[aria-label="${escapeAttribute(aria)}"]` : '';
}

function buildCssPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && parts.length < 6) {
    const tag = current.tagName.toLowerCase();
    if (current.id) { parts.unshift(`${tag}#${CSS.escape(current.id)}`); break; }
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) { parts.unshift(tag); break; }
    const siblings = Array.from(parent.children).filter((item) => item.tagName === current!.tagName);
    parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
    current = parent;
  }
  return parts.join(' > ');
}

function buildSessionId(formSignature: string): string {
  return `session_${hashString([location.origin, location.pathname, formSignature].join('|'))}`;
}

function buildFieldRule(field: Element): string {
  return [location.origin, location.pathname, buildFieldSignature(field as SupportedField)].join('|').toLowerCase();
}

function isEditableRoot(element: HTMLElement): boolean {
  if (!element.isContentEditable || element === document.body || element === document.documentElement) return false;
  return !element.parentElement?.closest('[contenteditable="true"]');
}

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function hasValue(value: FieldValue | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value?.trim());
}

function safePath(value: string): string {
  try { return new URL(value, location.href).pathname; } catch { return value.split('?')[0] ?? ''; }
}

function compact(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function escapeAttribute(value: string): string { return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 33) ^ value.charCodeAt(index);
  return (hash >>> 0).toString(36);
}

class ContentUi {
  private host?: HTMLDivElement;
  private shadow?: ShadowRoot;
  private hideTimer?: number;

  showStatus(message: string, tone: 'saving' | 'saved' | 'error'): void {
    if (window !== window.top) return;
    this.mount();
    const status = this.shadow?.querySelector<HTMLElement>('[data-status]');
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
    status.hidden = false;
    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => { status.hidden = true; }, tone === 'error' ? 4_000 : 2_000);
  }

  showRestore(field: HTMLElement, onRestore: () => void): void {
    this.mount();
    const button = this.shadow?.querySelector<HTMLButtonElement>('[data-restore]');
    if (!button) return;
    const rect = field.getBoundingClientRect();
    button.style.top = `${Math.max(8, rect.top + 6)}px`;
    button.style.left = `${Math.max(8, Math.min(innerWidth - 42, rect.right - 36))}px`;
    button.hidden = false;
    button.onpointerdown = (event) => event.preventDefault();
    button.onclick = onRestore;
  }

  hideRestore(): void {
    const button = this.shadow?.querySelector<HTMLButtonElement>('[data-restore]');
    if (button) button.hidden = true;
  }

  private mount(): void {
    if (this.shadow) return;
    this.host = document.createElement('div');
    document.documentElement.append(this.host);
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial}.status{position:fixed;right:16px;bottom:16px;z-index:2147483647;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;box-shadow:0 4px 14px rgba(15,23,42,.12);font:600 12px/1.2 system-ui;padding:8px 10px;animation:fs-in .18s ease-out}.status[data-tone=error]{border-color:#fecaca;color:#b91c1c}.restore{position:fixed;z-index:2147483647;width:30px;height:30px;border:1px solid #b8c8d8;border-radius:8px;background:#fff;color:#27628f;box-shadow:0 3px 10px rgba(15,23,42,.14);cursor:pointer;font:700 15px system-ui;transition:transform .14s ease,background .14s ease}.restore:hover{background:#edf4f8}.restore:active{transform:translateY(1px)}@keyframes fs-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}@media(prefers-color-scheme:dark){.status,.restore{border-color:#334155;background:#111827;color:#dbeafe}.restore:hover{background:#1e293b}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}';
    const status = document.createElement('div');
    status.className = 'status';
    status.dataset.status = '';
    status.hidden = true;
    const restore = document.createElement('button');
    restore.className = 'restore';
    restore.dataset.restore = '';
    restore.hidden = true;
    restore.title = 'Restore saved form';
    restore.ariaLabel = 'Restore saved form';
    restore.textContent = '↶';
    this.shadow.append(style, status, restore);
  }
}
