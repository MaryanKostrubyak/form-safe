import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import {
  Database,
  LockKeyhole,
  PanelRightOpen,
  PauseCircle,
  PlayCircle,
  Settings,
  ShieldCheck,
  Unlock,
} from "lucide-react";
import "../../src/styles/global.css";
import { Badge } from "../../src/components/Badge";
import { Button } from "../../src/components/Button";
import { Card } from "../../src/components/Card";
import { Input } from "../../src/components/Input";
import { t } from "../../src/lib/i18n";
import {
  MessageTypes,
  sendMessage,
  type AppMessage,
  type SiteStatus,
} from "../../src/lib/messages";
import { applyDocumentPreferences } from "../../src/lib/preferences";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";
import type {
  Settings as AppSettings,
  StorageStats,
  TabContext,
} from "../../src/types";
import type { SecurityStatus } from "../../src/lib/v2/security";
import { ALL_SITES_PATTERN } from "../../src/lib/v2/host-access";
import { openSidePanelAndClosePopup } from "../../src/lib/v2/side-panel";

function PopupApp() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [context, setContext] = useState<TabContext>();
  const [site, setSite] = useState<SiteStatus>();
  const [security, setSecurity] = useState<SecurityStatus>({
    enabled: false,
    locked: false,
  });
  const [stats, setStats] = useState<StorageStats>();
  const [access, setAccess] = useState<string[]>([]);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [panelError, setPanelError] = useState("");

  const load = async () => {
    const [settingsResult, contextResult, securityResult, accessResult] =
      await Promise.all([
        sendMessage<AppSettings>({ type: MessageTypes.GetSettings }),
        sendMessage<TabContext>({ type: MessageTypes.GetTabContext }),
        sendMessage<SecurityStatus>({ type: MessageTypes.GetSecurityStatus }),
        sendMessage<{ origins: string[] }>({
          type: MessageTypes.GetHostAccess,
        }),
      ]);
    if (settingsResult.ok) setSettings(settingsResult.data);
    if (contextResult.ok) {
      setContext(contextResult.data);
      if (contextResult.data.isSupported) {
        const result = await sendMessage<SiteStatus>({
          type: MessageTypes.GetSiteStatus,
          origin: contextResult.data.origin,
          hostname: contextResult.data.hostname,
        });
        if (result.ok) setSite(result.data);
      }
    }
    if (securityResult.ok) setSecurity(securityResult.data);
    if (accessResult.ok) setAccess(accessResult.data.origins);
    if (!securityResult.ok || !securityResult.data.locked) {
      const result = await sendMessage<StorageStats>({
        type: MessageTypes.StorageStats,
      });
      if (result.ok) setStats(result.data);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const listener = (message: AppMessage) => {
      if (message.type === MessageTypes.DataChanged) void load();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  useEffect(() => {
    applyDocumentPreferences(settings);
  }, [settings]);

  const hasAccess = Boolean(
    context?.isSupported &&
      access.some(
        (pattern) =>
        pattern === "<all_urls>" ||
        pattern === ALL_SITES_PATTERN ||
        pattern === "http://*/*" ||
          pattern === "https://*/*" ||
          pattern.startsWith(`${context.origin}/`),
      ),
  );
  const tr = (key: Parameters<typeof t>[1], values?: Parameters<typeof t>[2]) =>
    t(settings.language, key, values);
  const onboardingUrl = chrome.runtime.getURL(
    `/onboarding.html${context?.origin ? `?origin=${encodeURIComponent(context.origin)}` : ""}`,
  );
  const togglePause = async () => {
    if (!context) return;
    const result = await sendMessage<SiteStatus>({
      type: MessageTypes.TogglePauseOrigin,
      origin: context.origin,
    });
    if (result.ok) setSite(result.data);
  };
  const unlockStore = async () => {
    const result = await sendMessage<boolean>({
      type: MessageTypes.Unlock,
      passphrase,
    });
    if (result.ok && result.data) {
      setPassphrase("");
      await load();
    } else setError("Incorrect passphrase.");
  };
  const openDrafts = () => {
    setPanelError("");
    void openSidePanelAndClosePopup(
      chrome.sidePanel,
      context?.tabId,
      () => window.close(),
    ).then((opened) => {
      if (!opened) setPanelError(tr("sidePanelUnavailable"));
    });
  };

  return (
    <main className="w-[360px] bg-mist p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-lg bg-brand-600 text-white">
          <ShieldCheck className="size-4" />
        </div>
        <div>
          <h1 className="text-sm font-bold">FormSafe</h1>
          <p className="text-xs text-slate-500">{tr("appTagline")}</p>
        </div>
      </header>
      {security.locked ? (
        <Card className="mt-4 p-4">
          <div className="flex items-center gap-2">
            <LockKeyhole className="size-4 text-brand-600" />
            <h2 className="text-sm font-bold">Drafts are locked</h2>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Unlock once for this browser session to resume autosave.
          </p>
          <Input
            className="mt-3"
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void unlockStore();
            }}
            placeholder="Passphrase"
          />
          <Button
            className="mt-2 w-full"
            variant="primary"
            icon={<Unlock className="size-4" />}
            onClick={() => void unlockStore()}
          >
            Unlock
          </Button>
          {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
        </Card>
      ) : !context?.isSupported ? (
        <Card className="mt-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold">{tr("unavailablePage")}</h2>
            <Badge>{tr("statusUnavailable")}</Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            {tr("localNote")}
          </p>
        </Card>
      ) : !hasAccess ? (
        <Card className="mt-4 p-4">
          <h2 className="text-sm font-bold">Choose where FormSafe works</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Site access is requested only after you choose it.
          </p>
          <Button
            className="mt-3 w-full"
            variant="primary"
            onClick={() => chrome.tabs.create({ url: onboardingUrl })}
          >
            Set up access
          </Button>
        </Card>
      ) : (
        <>
          <Card className="mt-4 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {tr("currentSite")}
                </p>
                <h2 className="mt-1 truncate text-sm font-semibold">
                  {context?.hostname}
                </h2>
              </div>
              <Badge tone={site?.isPaused ? "amber" : "green"}>
                {site?.isPaused ? tr("statusPaused") : tr("statusActive")}
              </Badge>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs dark:border-slate-800 dark:bg-slate-950">
              <Database className="size-4 text-brand-600" />
              {tr("draftsSavedForSite", { count: site?.draftCount ?? 0 })}
            </div>
          </Card>
          {stats && stats.approximateBytes > stats.maxBytes * 0.8 ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Storage is over 80% of the FormSafe limit.
            </p>
          ) : null}
          <div className="mt-3 grid gap-2">
            <Button
              variant="primary"
              icon={<PanelRightOpen className="size-4" />}
              onClick={openDrafts}
            >
              {tr("openDrafts")}
            </Button>
            <Button
              icon={
                site?.isPaused ? (
                  <PlayCircle className="size-4" />
                ) : (
                  <PauseCircle className="size-4" />
                )
              }
              onClick={() => void togglePause()}
            >
              {site?.isPaused ? tr("resumeOnSite") : tr("pauseOnSite")}
            </Button>
            {panelError ? (
              <p
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                role="alert"
              >
                {panelError}
              </p>
            ) : null}
          </div>
        </>
      )}
      <Button
        className="mt-2 w-full"
        variant="ghost"
        icon={<Settings className="size-4" />}
        onClick={() => chrome.runtime.openOptionsPage()}
      >
        {tr("settings")}
      </Button>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<PopupApp />);
