export type FieldType =
  | 'textarea'
  | 'text'
  | 'search'
  | 'email'
  | 'contenteditable'
  | 'select'
  | 'checkbox'
  | 'radio';
export type FieldValue = string | boolean | string[];
export type SessionStatus = 'active' | 'submit-pending' | 'completed' | 'archived';
export type VersionReason = 'migration' | 'idle' | 'clear' | 'restore' | 'submit' | 'pagehide' | 'manual';
export type LanguageCode =
  | 'en'
  | 'es'
  | 'zh'
  | 'hi'
  | 'ar'
  | 'fr'
  | 'pt'
  | 'de'
  | 'ja'
  | 'ko'
  | 'uk'
  | 'ru';
export type ThemeMode = 'system' | 'light' | 'dark';

export interface SelectorInfo {
  selector: string;
  fallbackSelector: string;
  formSignature: string;
  fieldSignature: string;
  fieldName?: string;
  fieldId?: string;
  placeholder?: string;
}

export interface Draft {
  id: string;
  origin: string;
  url: string;
  pathname: string;
  pageTitle: string;
  fieldLabel: string;
  fieldType: FieldType;
  selectorInfo: SelectorInfo;
  value: string;
  createdAt: number;
  updatedAt: number;
  lastSavedAt: number;
  restoreCount: number;
  isArchived: boolean;
  isFavorite: boolean;
}

export interface FieldSnapshot {
  id: string;
  label: string;
  type: FieldType;
  value: FieldValue;
  selectorInfo: SelectorInfo;
  ignored?: boolean;
}

export interface DraftVersion {
  id: string;
  createdAt: number;
  reason: VersionReason;
  fields: FieldSnapshot[];
}

export interface FormDraftSession {
  id: string;
  schemaVersion: 2;
  origin: string;
  url: string;
  pathname: string;
  pageTitle: string;
  formSignature: string;
  frameUrl: string;
  fields: FieldSnapshot[];
  versions: DraftVersion[];
  createdAt: number;
  updatedAt: number;
  lastSavedAt: number;
  pendingSubmitAt?: number;
  completedAt?: number;
  restoreCount: number;
  status: SessionStatus;
  isFavorite: boolean;
  approximateBytes: number;
}

export interface SessionQuery {
  query?: string;
  origin?: string;
  pathname?: string;
  status?: SessionStatus | 'all';
  favoritesOnly?: boolean;
  cursor?: string;
  limit?: number;
}

export interface SessionPage {
  items: FormDraftSession[];
  nextCursor?: string;
  total: number;
}

export interface StorageStats {
  sessions: number;
  versions: number;
  approximateBytes: number;
  maxBytes: number;
  maxSessions: number;
}

export interface SessionCapture {
  id: string;
  origin: string;
  url: string;
  pathname: string;
  pageTitle: string;
  formSignature: string;
  frameUrl: string;
  fields: FieldSnapshot[];
}

export interface Settings {
  autosaveEnabled: boolean;
  autosaveDelayMs: number;
  minCharacters: number;
  saveContentEditable: boolean;
  saveEmailFields: boolean;
  autoDeleteDays: number;
  siteBlacklist: string[];
  whitelistMode: boolean;
  siteWhitelist: string[];
  showRestorePopup: boolean;
  showSaveStatus: boolean;
  language: LanguageCode;
  theme: ThemeMode;
  onboardingComplete: boolean;
  hostAccessMode: 'unconfigured' | 'all' | 'selected';
  saveSafeControls: boolean;
  ignoredFieldRules: string[];
}

export interface TabContext {
  tabId?: number;
  url: string;
  origin: string;
  pathname: string;
  hostname: string;
  title: string;
  isSupported: boolean;
}

export type DraftFilter = 'all' | 'current-site' | 'favorites' | 'archived';
