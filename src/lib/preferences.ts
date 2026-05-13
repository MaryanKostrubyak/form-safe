import type { LanguageCode, Settings, ThemeMode } from '../types';
import { isRtlLanguage } from './i18n';

export function getEffectiveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyDocumentPreferences(settings: Pick<Settings, 'language' | 'theme'>): void {
  const theme = getEffectiveTheme(settings.theme);
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  document.documentElement.lang = settings.language;
  document.documentElement.dir = isRtlLanguage(settings.language as LanguageCode) ? 'rtl' : 'ltr';
}
