export type FieldType = 'textarea' | 'text' | 'search' | 'email' | 'contenteditable';
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
}

export interface TabContext {
  url: string;
  origin: string;
  pathname: string;
  hostname: string;
  title: string;
  isSupported: boolean;
}

export type DraftFilter = 'all' | 'current-site' | 'favorites' | 'archived';
