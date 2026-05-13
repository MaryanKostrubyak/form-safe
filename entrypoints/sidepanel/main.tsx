import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Archive, FileSearch, Heart, Search, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import '../../src/styles/global.css';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { DraftCard } from '../../src/components/DraftCard';
import { EmptyState } from '../../src/components/EmptyState';
import { Input } from '../../src/components/Input';
import { Skeleton } from '../../src/components/Skeleton';
import { Toast, type ToastTone } from '../../src/components/Toast';
import { cn } from '../../src/lib/cn';
import { getDomain, sortDraftsNewestFirst } from '../../src/lib/format';
import { t } from '../../src/lib/i18n';
import {
  MessageTypes,
  sendMessage,
} from '../../src/lib/messages';
import { applyDocumentPreferences } from '../../src/lib/preferences';
import { DEFAULT_SETTINGS } from '../../src/lib/settings';
import type { Draft, DraftFilter, Settings, TabContext } from '../../src/types';

interface ToastState {
  message: string;
  tone: ToastTone;
}

interface SidePanelAppProps {
  initialSettings: Settings;
}

function SidePanelApp({ initialSettings }: SidePanelAppProps) {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [context, setContext] = useState<TabContext | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DraftFilter>('all');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState | null>(null);

  const language = settings.language;
  const filters: Array<{ id: DraftFilter; label: string }> = [
    { id: 'all', label: t(language, 'all') },
    { id: 'current-site', label: t(language, 'currentSiteFilter') },
    { id: 'favorites', label: t(language, 'favorites') },
    { id: 'archived', label: t(language, 'archived') },
  ];

  useEffect(() => {
    applyDocumentPreferences(settings);
    if (settings.theme !== 'system') return undefined;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyDocumentPreferences(settings);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [settings]);

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 2000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [settingsResponse, tabResponse, draftResponse] = await Promise.all([
      sendMessage<Settings>({ type: MessageTypes.GetSettings }),
      sendMessage<TabContext>({ type: MessageTypes.GetTabContext }),
      sendMessage<Draft[]>({ type: MessageTypes.GetDrafts }),
    ]);

    if (settingsResponse.ok) setSettings(settingsResponse.data);
    else showToast(settingsResponse.error, 'error');

    if (tabResponse.ok) setContext(tabResponse.data);

    if (draftResponse.ok) setDrafts(draftResponse.data);
    else showToast(draftResponse.error, 'error');

    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentPageDrafts = useMemo(() => {
    if (!context?.isSupported) return [];
    return sortDraftsNewestFirst(
      drafts.filter(
        (draft) =>
          !draft.isArchived &&
          draft.origin === context.origin &&
          draft.pathname === context.pathname,
      ),
    );
  }, [context, drafts]);

  const filteredDrafts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return sortDraftsNewestFirst(
      drafts.filter((draft) => {
        if (filter === 'current-site' && draft.origin !== context?.origin) return false;
        if (filter === 'favorites' && !draft.isFavorite) return false;
        if (filter === 'archived' && !draft.isArchived) return false;
        if (filter === 'all' && draft.isArchived) return false;

        if (!normalizedQuery) return true;
        return [getDomain(draft.origin), draft.pageTitle, draft.fieldLabel, draft.value]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      }),
    );
  }, [context?.origin, drafts, filter, query]);

  const favoriteDrafts = useMemo(
    () => sortDraftsNewestFirst(drafts.filter((draft) => draft.isFavorite && !draft.isArchived)).slice(0, 6),
    [drafts],
  );

  const updateDraftLocal = (draft: Draft) => {
    setDrafts((current) => sortDraftsNewestFirst(current.map((item) => (item.id === draft.id ? draft : item))));
  };

  const copyDraft = async (draft: Draft) => {
    try {
      await navigator.clipboard.writeText(draft.value);
      showToast(t(language, 'copied'), 'success');
    } catch {
      showToast(t(language, 'clipboardError'), 'error');
    }
  };

  const toggleFavorite = async (draft: Draft) => {
    const response = await sendMessage<Draft | null>({
      type: MessageTypes.UpdateDraft,
      id: draft.id,
      patch: { isFavorite: !draft.isFavorite },
    });

    if (response.ok && response.data) {
      updateDraftLocal(response.data);
    } else {
      showToast(response.ok ? t(language, 'draftNotFound') : response.error, 'error');
    }
  };

  const deleteDraft = async (draft: Draft) => {
    const response = await sendMessage<boolean>({ type: MessageTypes.DeleteDraft, id: draft.id });
    if (response.ok && response.data) {
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      showToast(t(language, 'draftDeleted'), 'success');
    } else {
      showToast(response.ok ? t(language, 'deleteFailed') : response.error, 'error');
    }
  };

  const restoreDraft = async (draft: Draft) => {
    const response = await sendMessage<boolean>({ type: MessageTypes.RestoreDraftToTab, draft });
    if (response.ok && response.data) showToast(t(language, 'restoredOnPage'), 'success');
    else showToast(response.ok ? t(language, 'fieldNotFound') : response.error, 'error');
  };

  const canRestore = (draft: Draft) =>
    Boolean(context?.isSupported && draft.origin === context.origin && draft.pathname === context.pathname && !draft.isArchived);

  return (
    <main className="min-h-screen bg-mist text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-white">
              <ShieldCheck className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold">FormSafe</h1>
              <p className="truncate text-xs text-slate-600 dark:text-slate-400">
                {context?.isSupported ? getDomain(context.origin) : t(language, 'unavailablePage')}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={<SettingsIcon className="size-4" />} onClick={() => chrome.runtime.openOptionsPage()}>
            {t(language, 'settings')}
          </Button>
        </div>
      </header>

      <section className="space-y-4 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 rtl:left-auto rtl:right-3" />
          <Input
            className="pl-9 rtl:pl-3 rtl:pr-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(language, 'searchPlaceholder')}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                filter === item.id
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid gap-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : (
          <>
            {!query && filter === 'all' ? (
              <Section title={t(language, 'currentPageDrafts')} count={currentPageDrafts.length}>
                {currentPageDrafts.length > 0 ? (
                  currentPageDrafts.map((draft) => (
                    <DraftCard
                      key={draft.id}
                      draft={draft}
                      language={language}
                      canRestore={canRestore(draft)}
                      onCopy={copyDraft}
                      onRestore={restoreDraft}
                      onFavorite={toggleFavorite}
                      onDelete={deleteDraft}
                    />
                  ))
                ) : (
                  <EmptyState
                    title={t(language, 'noDraftsPageTitle')}
                    description={t(language, 'noDraftsPageDesc')}
                  />
                )}
              </Section>
            ) : null}

            <Section
              title={filter === 'favorites' ? t(language, 'favoriteDrafts') : filter === 'archived' ? t(language, 'archive') : t(language, 'recentDrafts')}
              count={filteredDrafts.length}
            >
              {filteredDrafts.length > 0 ? (
                filteredDrafts.map((draft) => (
                  <DraftCard
                    key={draft.id}
                    draft={draft}
                    language={language}
                    canRestore={canRestore(draft)}
                    onCopy={copyDraft}
                    onRestore={restoreDraft}
                    onFavorite={toggleFavorite}
                    onDelete={deleteDraft}
                  />
                ))
              ) : (
                <EmptyState
                  icon={filter === 'favorites' ? <Heart className="size-5" /> : filter === 'archived' ? <Archive className="size-5" /> : <FileSearch className="size-5" />}
                  title={t(language, 'nothingFoundTitle')}
                  description={t(language, 'nothingFoundDesc')}
                />
              )}
            </Section>

            {!query && filter === 'all' && favoriteDrafts.length > 0 ? (
              <Section title={t(language, 'favoriteDrafts')} count={favoriteDrafts.length}>
                {favoriteDrafts.map((draft) => (
                  <DraftCard
                    key={draft.id}
                    draft={draft}
                    language={language}
                    canRestore={canRestore(draft)}
                    onCopy={copyDraft}
                    onRestore={restoreDraft}
                    onFavorite={toggleFavorite}
                    onDelete={deleteDraft}
                  />
                ))}
              </Section>
            ) : null}
          </>
        )}

        <div className="rounded-xl border border-brand-200 bg-white px-3 py-2 text-xs font-medium leading-5 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          {t(language, 'storageNote')}
        </div>
      </section>

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </main>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">{title}</h2>
        <Badge>{count}</Badge>
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

void bootstrap();

async function bootstrap(): Promise<void> {
  const initialSettings = await loadInitialSettings();
  applyDocumentPreferences(initialSettings);
  createRoot(document.getElementById('root')!).render(<SidePanelApp initialSettings={initialSettings} />);
}

async function loadInitialSettings(): Promise<Settings> {
  const response = await sendMessage<Settings>({ type: MessageTypes.GetSettings });
  return response.ok ? response.data : DEFAULT_SETTINGS;
}
