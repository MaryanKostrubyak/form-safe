import type { Draft, LanguageCode } from '../types';

const LOCALES: Record<LanguageCode, string> = {
  en: 'en-US',
  es: 'es-ES',
  zh: 'zh-CN',
  hi: 'hi-IN',
  ar: 'ar',
  fr: 'fr-FR',
  pt: 'pt-BR',
  de: 'de-DE',
  ja: 'ja-JP',
  ko: 'ko-KR',
  uk: 'uk-UA',
  ru: 'ru-RU',
};

export function getDomain(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    return origin;
  }
}

export function getLocale(language: LanguageCode): string {
  return LOCALES[language] ?? LOCALES.en;
}

export function formatRelativeTime(timestamp: number, language: LanguageCode = 'en'): string {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  const locale = getLocale(language);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (seconds < 5) return relative.format(0, 'second');
  if (seconds < 60) return relative.format(-seconds, 'second');

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return relative.format(-minutes, 'minute');

  const hours = Math.round(minutes / 60);
  if (hours < 24) return relative.format(-hours, 'hour');

  const days = Math.round(hours / 24);
  if (days < 30) return relative.format(-days, 'day');

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: new Date(timestamp).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(timestamp);
}

export function previewText(value: string, maxLength = 180): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}...`;
}

export function sortDraftsNewestFirst(drafts: Draft[]): Draft[] {
  return [...drafts].sort((a, b) => b.updatedAt - a.updatedAt);
}
