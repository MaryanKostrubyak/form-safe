import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Archive,
  FileText,
  Heart,
  LockKeyhole,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
} from "lucide-react";
import "../../src/styles/global.css";
import { Button } from "../../src/components/Button";
import { EmptyState } from "../../src/components/EmptyState";
import { Input } from "../../src/components/Input";
import { SessionCard } from "../../src/components/SessionCard";
import { Skeleton } from "../../src/components/Skeleton";
import { Toast } from "../../src/components/Toast";
import { t } from "../../src/lib/i18n";
import {
  MessageTypes,
  sendMessage,
  type AppMessage,
} from "../../src/lib/messages";
import { applyDocumentPreferences } from "../../src/lib/preferences";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";
import type {
  FormDraftSession,
  SessionPage,
  SessionStatus,
  Settings,
  TabContext,
} from "../../src/types";
import type { SecurityStatus } from "../../src/lib/v2/security";

type Filter = "all" | "site" | SessionStatus | "favorites";

function SidePanelApp() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [sessions, setSessions] = useState<FormDraftSession[]>([]);
  const [context, setContext] = useState<TabContext | null>(null);
  const [security, setSecurity] = useState<SecurityStatus>({
    enabled: false,
    locked: false,
  });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string>();
  const [passphrase, setPassphrase] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error" | "info";
  }>();
  const tr = (key: Parameters<typeof t>[1], values?: Parameters<typeof t>[2]) =>
    t(settings.language, key, values);

  const load = useCallback(async () => {
    const [settingsResult, contextResult, securityResult] = await Promise.all([
      sendMessage<Settings>({ type: MessageTypes.GetSettings }),
      sendMessage<TabContext>({ type: MessageTypes.GetTabContext }),
      sendMessage<SecurityStatus>({ type: MessageTypes.GetSecurityStatus }),
    ]);
    if (settingsResult.ok) setSettings(settingsResult.data);
    if (contextResult.ok) setContext(contextResult.data);
    if (securityResult.ok) setSecurity(securityResult.data);
    setLoading(false);
  }, []);

  const loadSessions = useCallback(
    async (cursor?: string) => {
      if (security.locked) return;
      const page = await sendMessage<SessionPage>({
        type: MessageTypes.QuerySessions,
        query: {
          query: query || undefined,
          origin: filter === "site" ? context?.origin : undefined,
          status:
            filter !== "all" && filter !== "site" && filter !== "favorites"
              ? filter
              : undefined,
          favoritesOnly: filter === "favorites",
          cursor,
          limit: 25,
        },
      });
      if (!page.ok) return;
      setSessions((current) =>
        cursor ? [...current, ...page.data.items] : page.data.items,
      );
      setTotal(page.data.total);
      setNextCursor(page.data.nextCursor);
    },
    [context?.origin, filter, query, security.locked],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadSessions(), 180);
    return () => window.clearTimeout(timer);
  }, [loadSessions]);
  useEffect(() => {
    applyDocumentPreferences(settings);
    const listener = (message: AppMessage) => {
      if (message.type === MessageTypes.DataChanged) {
        void load();
        void loadSessions();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.tabs?.onActivated?.addListener(load);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.tabs?.onActivated?.removeListener(load);
    };
  }, [load, loadSessions, settings]);

  const notify = (
    message: string,
    tone: "success" | "error" | "info" = "info",
  ) => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(undefined), 2200);
  };
  const restore = async (
    session: FormDraftSession,
    versionId?: string,
    fieldIds?: string[],
  ) => {
    const result = await sendMessage<boolean>({
      type: MessageTypes.RestoreSession,
      id: session.id,
      versionId,
      fieldIds,
    });
    notify(
      result.ok && result.data
        ? "Form restored on the active page."
        : "Open the matching page before restoring.",
      result.ok && result.data ? "success" : "error",
    );
  };
  const checkpoint = async (session: FormDraftSession) => {
    const result = await sendMessage<FormDraftSession | null>({
      type: MessageTypes.CheckpointSession,
      id: session.id,
    });
    if (result.ok && result.data) {
      setSessions((current) =>
        current.map((item) =>
          item.id === result.data!.id ? result.data! : item,
        ),
      );
      notify("Checkpoint created.", "success");
    }
  };
  const copy = async (session: FormDraftSession) => {
    await navigator.clipboard.writeText(
      session.fields
        .map((field) => `${field.label}: ${String(field.value)}`)
        .join("\n\n"),
    );
    notify("Session copied.", "success");
  };
  const patch = async (
    session: FormDraftSession,
    value: Partial<Pick<FormDraftSession, "status" | "isFavorite">>,
  ) => {
    const result = await sendMessage<FormDraftSession | null>({
      type: MessageTypes.PatchSession,
      id: session.id,
      patch: value,
    });
    if (result.ok && result.data)
      setSessions((current) =>
        current.map((item) =>
          item.id === result.data!.id ? result.data! : item,
        ),
      );
  };
  const remove = async (session: FormDraftSession) => {
    const result = await sendMessage<boolean>({
      type: MessageTypes.DeleteSession,
      id: session.id,
    });
    if (result.ok && result.data)
      setSessions((current) =>
        current.filter((item) => item.id !== session.id),
      );
  };
  const unlockStore = async () => {
    const result = await sendMessage<boolean>({
      type: MessageTypes.Unlock,
      passphrase,
    });
    if (result.ok && result.data) {
      setPassphrase("");
      await load();
    } else notify("Passphrase is incorrect.", "error");
  };

  if (security.locked)
    return (
      <main className="grid min-h-screen place-items-center bg-mist p-5 dark:bg-slate-950">
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <LockKeyhole className="size-6 text-brand-600" />
          <h1 className="mt-4 text-base font-bold">Unlock FormSafe</h1>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Encrypted drafts stay unavailable until you unlock them for this
            browser session.
          </p>
          <Input
            className="mt-4"
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void unlockStore();
            }}
            placeholder="Passphrase"
            autoFocus
          />
          <Button
            className="mt-3 w-full"
            variant="primary"
            onClick={() => void unlockStore()}
          >
            Unlock
          </Button>
          {toast ? <Toast {...toast} /> : null}
        </div>
      </main>
    );

  const filters: Array<{ id: Filter; label: string; icon?: ReactNode }> = [
    { id: "all", label: tr("all") },
    { id: "site", label: tr("currentSiteFilter") },
    { id: "active", label: tr("statusActive") },
    { id: "completed", label: "Completed" },
    {
      id: "archived",
      label: tr("archived"),
      icon: <Archive className="size-3" />,
    },
    {
      id: "favorites",
      label: tr("favorites"),
      icon: <Heart className="size-3" />,
    },
  ];

  return (
    <main className="min-h-screen bg-mist text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white">
              <ShieldCheck className="size-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold">FormSafe</h1>
              <p className="max-w-44 truncate text-xs text-slate-500">
                {context?.hostname || tr("recovery")}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<SettingsIcon className="size-4" />}
            onClick={() => chrome.runtime.openOptionsPage()}
          >
            {tr("settings")}
          </Button>
        </div>
      </header>
      <section className="space-y-4 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tr("searchPlaceholder")}
            aria-label={tr("searchPlaceholder")}
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 ${filter === item.id ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"}`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Form sessions
          </h2>
          <span className="text-xs tabular-nums text-slate-500">{total}</span>
        </div>
        {loading ? (
          <div className="grid gap-2">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        ) : sessions.length ? (
          <div className="grid gap-2.5">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                language={settings.language}
                canRestore={Boolean(
                  context?.isSupported &&
                    context.origin === session.origin &&
                    context.pathname === session.pathname,
                )}
                onRestore={restore}
                onCheckpoint={checkpoint}
                onCopy={copy}
                onPatch={patch}
                onDelete={remove}
              />
            ))}
            {nextCursor ? (
              <Button
                variant="ghost"
                onClick={() => void loadSessions(nextCursor)}
              >
                Load more
              </Button>
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon={<FileText className="size-5" />}
            title={tr("nothingFoundTitle")}
            description={tr("nothingFoundDesc")}
          />
        )}
      </section>
      {toast ? <Toast {...toast} /> : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<SidePanelApp />);
