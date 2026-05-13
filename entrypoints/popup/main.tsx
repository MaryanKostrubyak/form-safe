import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useState } from 'react';
import { FileText, PanelRightOpen, PauseCircle, PlayCircle, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import '../../src/styles/global.css';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Skeleton } from '../../src/components/Skeleton';
import { Toast, type ToastTone } from '../../src/components/Toast';
import { getDomain } from '../../src/lib/format';
import { t } from '../../src/lib/i18n';
import {
  MessageTypes,
  sendMessage,
  type SiteStatus,
} from '../../src/lib/messages';
import { applyDocumentPreferences } from '../../src/lib/preferences';
import { DEFAULT_SETTINGS } from '../../src/lib/settings';
import type { Settings, TabContext } from '../../src/types';

interface ToastState {
  message: string;
  tone: ToastTone;
}

interface PopupAppProps {
  initialSettings: Settings;
}

function PopupApp({ initialSettings }: PopupAppProps) {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [context, setContext] = useState<TabContext | null>(null);
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState | null>(null);

  const language = settings.language;

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
    const [settingsResponse, tabResponse] = await Promise.all([
      sendMessage<Settings>({ type: MessageTypes.GetSettings }),
      sendMessage<TabContext>({ type: MessageTypes.GetTabContext }),
    ]);

    const nextSettings = settingsResponse.ok ? settingsResponse.data : DEFAULT_SETTINGS;
    setSettings(nextSettings);

    if (!tabResponse.ok) {
      setLoading(false);
      showToast(tabResponse.error, 'error');
      return;
    }

    setContext(tabResponse.data);
    if (tabResponse.data.isSupported) {
      const statusResponse = await sendMessage<SiteStatus>({
        type: MessageTypes.GetSiteStatus,
        origin: tabResponse.data.origin,
        hostname: tabResponse.data.hostname,
      });
      if (statusResponse.ok) {
        setStatus(statusResponse.data);
        setSettings(statusResponse.data.settings);
      } else {
        showToast(statusResponse.error, 'error');
      }
    }

    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openSidePanel = async () => {
    const tabId = await getActiveTabId();

    if (tabId && chrome.sidePanel?.open) {
      try {
        await chrome.sidePanel.setOptions?.({
          tabId,
          path: 'sidepanel.html',
          enabled: true,
        });
        await chrome.sidePanel.open({ tabId });
        window.close();
        return;
      } catch {
        // Some Chrome contexts only allow side panel opening through the background worker.
      }
    }

    const response = await sendMessage<boolean>({ type: MessageTypes.OpenSidePanel, tabId });
    if (!response.ok || !response.data) showToast(response.ok ? t(language, 'sidePanelUnavailable') : response.error, 'error');
    else window.close();
  };

  const togglePause = async () => {
    if (!context?.isSupported) return;
    const response = await sendMessage<SiteStatus>({
      type: MessageTypes.TogglePauseOrigin,
      origin: context.origin,
    });
    if (response.ok) {
      setStatus(response.data);
      setSettings(response.data.settings);
      showToast(response.data.isPaused ? t(language, 'autosavePaused') : t(language, 'autosaveResumed'), 'success');
    } else {
      showToast(response.error, 'error');
    }
  };

  const openSettings = () => {
    chrome.runtime.openOptionsPage();
  };

  const currentDomain = context?.isSupported ? getDomain(context.origin) : t(language, 'unavailablePage');
  const isPaused = Boolean(status?.isPaused);
  const draftCount = status?.draftCount ?? 0;

  return (
    <main className="w-[360px] bg-mist p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-brand-600 text-white shadow-soft">
          <ShieldCheck className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-bold tracking-tight">FormSafe</h1>
          <p className="truncate text-xs text-slate-600 dark:text-slate-400">{t(language, 'appTagline')}</p>
        </div>
      </header>

      <Card className="mt-4 p-3">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t(language, 'currentSite')}
                </p>
                <h2 className="mt-1 truncate text-sm font-semibold">{currentDomain}</h2>
              </div>
              <Badge tone={context?.isSupported ? (isPaused ? 'amber' : 'green') : 'neutral'}>
                {context?.isSupported
                  ? isPaused
                    ? t(language, 'statusPaused')
                    : t(language, 'statusActive')
                  : t(language, 'statusUnavailable')}
              </Badge>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-950/70">
              <FileText className="size-4 text-brand-600 dark:text-brand-100" />
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t(language, 'draftsSavedForSite', { count: draftCount })}
              </p>
            </div>
          </>
        )}
      </Card>

      <div className="mt-4 grid gap-2">
        <Button variant="primary" icon={<PanelRightOpen className="size-4" />} onClick={openSidePanel}>
          {t(language, 'openDrafts')}
        </Button>
        <Button
          variant="secondary"
          icon={isPaused ? <PlayCircle className="size-4" /> : <PauseCircle className="size-4" />}
          onClick={togglePause}
          disabled={!context?.isSupported}
        >
          {isPaused ? t(language, 'resumeOnSite') : t(language, 'pauseOnSite')}
        </Button>
        <Button variant="ghost" icon={<SettingsIcon className="size-4" />} onClick={openSettings}>
          {t(language, 'settings')}
        </Button>
      </div>

      <p className="mt-4 rounded-lg border border-brand-200 bg-white px-3 py-2 text-[12px] font-medium leading-5 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        {t(language, 'localNote')}
      </p>

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </main>
  );
}

void bootstrap();

async function bootstrap(): Promise<void> {
  const initialSettings = await loadInitialSettings();
  applyDocumentPreferences(initialSettings);
  createRoot(document.getElementById('root')!).render(<PopupApp initialSettings={initialSettings} />);
}

async function loadInitialSettings(): Promise<Settings> {
  const response = await sendMessage<Settings>({ type: MessageTypes.GetSettings });
  return response.ok ? response.data : DEFAULT_SETTINGS;
}

function getActiveTabId(): Promise<number | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => resolve(tab?.id));
  });
}
