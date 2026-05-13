import type { LanguageCode, Settings, ThemeMode } from '../types';

export const DEFAULT_SETTINGS: Settings = {
  autosaveEnabled: true,
  autosaveDelayMs: 850,
  minCharacters: 3,
  saveContentEditable: true,
  saveEmailFields: false,
  autoDeleteDays: 90,
  siteBlacklist: [],
  whitelistMode: false,
  siteWhitelist: [],
  showRestorePopup: true,
  showSaveStatus: true,
  language: 'en',
  theme: 'system',
};

const LANGUAGE_CODES: LanguageCode[] = ['en', 'es', 'zh', 'hi', 'ar', 'fr', 'pt', 'de', 'ja', 'ko', 'uk', 'ru'];
const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

export function normalizeSettings(value: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    autosaveDelayMs: clampNumber(value?.autosaveDelayMs, 300, 2500, DEFAULT_SETTINGS.autosaveDelayMs),
    minCharacters: clampNumber(value?.minCharacters, 1, 1000, DEFAULT_SETTINGS.minCharacters),
    autoDeleteDays: clampNumber(value?.autoDeleteDays, 1, 3650, DEFAULT_SETTINGS.autoDeleteDays),
    siteBlacklist: normalizeRules(value?.siteBlacklist),
    siteWhitelist: normalizeRules(value?.siteWhitelist),
    language: normalizeChoice(value?.language, LANGUAGE_CODES, DEFAULT_SETTINGS.language),
    theme: normalizeChoice(value?.theme, THEME_MODES, DEFAULT_SETTINGS.theme),
  };
}

export function isSiteAllowed(settings: Settings, origin: string, hostname: string): boolean {
  if (!settings.autosaveEnabled) return false;
  if (settings.siteBlacklist.some((rule) => matchesSiteRule(rule, origin, hostname))) return false;
  if (settings.whitelistMode) {
    return settings.siteWhitelist.some((rule) => matchesSiteRule(rule, origin, hostname));
  }
  return true;
}

export function toggleOriginRule(rules: string[], origin: string): string[] {
  const normalized = normalizeRule(origin);
  if (!normalized) return rules;

  const next = new Set(normalizeRules(rules));
  if (next.has(normalized)) next.delete(normalized);
  else next.add(normalized);
  return [...next].sort();
}

export function isOriginPaused(settings: Settings, origin: string, hostname: string): boolean {
  return settings.siteBlacklist.some((rule) => matchesSiteRule(rule, origin, hostname));
}

export function getHostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function normalizeRules(rules: string[] | undefined): string[] {
  return [...new Set((rules ?? []).map(normalizeRule).filter(Boolean))].sort();
}

function normalizeRule(rule: string): string {
  const trimmed = rule.trim().toLowerCase();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.pathname === '/' ? url.origin : `${url.origin}${url.pathname}`.replace(/\/$/, '');
  } catch {
    return trimmed.replace(/\/$/, '');
  }
}

function matchesSiteRule(rule: string, origin: string, hostname: string): boolean {
  const normalizedRule = normalizeRule(rule);
  if (!normalizedRule) return false;

  const lowerOrigin = origin.toLowerCase();
  const lowerHostname = hostname.toLowerCase();

  if (normalizedRule === lowerOrigin || normalizedRule === lowerHostname) return true;

  if (normalizedRule.startsWith('*.')) {
    const suffix = normalizedRule.slice(2);
    return lowerHostname === suffix || lowerHostname.endsWith(`.${suffix}`);
  }

  if (normalizedRule.startsWith('.')) {
    const suffix = normalizedRule.slice(1);
    return lowerHostname === suffix || lowerHostname.endsWith(`.${suffix}`);
  }

  if (!normalizedRule.includes('://')) {
    return lowerHostname === normalizedRule || lowerHostname.endsWith(`.${normalizedRule}`);
  }

  return lowerOrigin.startsWith(normalizedRule);
}

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeChoice<T extends string>(value: T | undefined, allowed: readonly T[], fallback: T): T {
  return value && allowed.includes(value) ? value : fallback;
}
