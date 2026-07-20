import { createRoot } from "react-dom/client";
import { useEffect, useState, type ReactNode } from "react";
import {
  Database,
  Download,
  Eye,
  Globe2,
  LockKeyhole,
  Moon,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import "../../src/styles/global.css";
import { Badge } from "../../src/components/Badge";
import { Button } from "../../src/components/Button";
import { Card } from "../../src/components/Card";
import { Input, Select, Textarea } from "../../src/components/Input";
import { Toggle } from "../../src/components/Toggle";
import {
  MessageTypes,
  sendMessage,
  type AppMessage,
  type ImportPreviewResponse,
} from "../../src/lib/messages";
import { applyDocumentPreferences } from "../../src/lib/preferences";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../src/lib/settings";
import type {
  LanguageCode,
  Settings,
  StorageStats,
  ThemeMode,
} from "../../src/types";
import type { SecurityStatus } from "../../src/lib/v2/security";
import { SUPPORTED_LANGUAGES, t } from "../../src/lib/i18n";

function OptionsApp() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [security, setSecurity] = useState<SecurityStatus>({
    enabled: false,
    locked: false,
  });
  const [stats, setStats] = useState<StorageStats>();
  const [origins, setOrigins] = useState<string[]>([]);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [pendingImport, setPendingImport] = useState<{
    contents: string;
    preview: ImportPreviewResponse;
  }>();
  const [message, setMessage] = useState("");
  const tr = (key: Parameters<typeof t>[1], values?: Parameters<typeof t>[2]) =>
    t(settings.language, key, values);

  const load = async () => {
    const [settingsResult, securityResult, accessResult] = await Promise.all([
      sendMessage<Settings>({ type: MessageTypes.GetSettings }),
      sendMessage<SecurityStatus>({ type: MessageTypes.GetSecurityStatus }),
      sendMessage<{ origins: string[] }>({ type: MessageTypes.GetHostAccess }),
    ]);
    if (settingsResult.ok) setSettings(settingsResult.data);
    if (securityResult.ok) setSecurity(securityResult.data);
    if (accessResult.ok) setOrigins(accessResult.data.origins);
    if (!securityResult.ok || !securityResult.data.locked) {
      const statsResult = await sendMessage<StorageStats>({
        type: MessageTypes.StorageStats,
      });
      if (statsResult.ok) setStats(statsResult.data);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    applyDocumentPreferences(settings);
    const listener = (event: AppMessage) => {
      if (event.type === MessageTypes.DataChanged) void load();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [settings]);

  const save = async (next: Settings) => {
    const normalized = normalizeSettings(next);
    setSettings(normalized);
    const result = await sendMessage<boolean>({
      type: MessageTypes.SaveSettings,
      settings: normalized,
    });
    setMessage(
      result.ok && result.data
        ? t(normalized.language, "settingsSaved")
        : t(normalized.language, "settingsSaveFailed"),
    );
  };
  const patch = (value: Partial<Settings>) =>
    void save({ ...settings, ...value });
  const toggleEncryption = async () => {
    if (passphrase.length < 10) {
      setMessage("Use a passphrase with at least 10 characters.");
      return;
    }
    if (!security.enabled && passphrase !== confirm) {
      setMessage("Passphrases do not match.");
      return;
    }
    const result = security.enabled
      ? await sendMessage<boolean>({
          type: MessageTypes.DisableEncryption,
          passphrase,
        })
      : await sendMessage<boolean>({
          type: MessageTypes.EnableEncryption,
          passphrase,
        });
    setMessage(
      result.ok && result.data
        ? security.enabled
          ? "Encryption disabled."
          : "Encryption enabled."
        : result.ok
          ? "Incorrect passphrase."
          : result.error,
    );
    setPassphrase("");
    setConfirm("");
    await load();
  };
  const updatePassphrase = async () => {
    if (newPassphrase.length < 10) {
      setMessage("Use a new passphrase with at least 10 characters.");
      return;
    }
    if (newPassphrase !== confirm) {
      setMessage("New passphrases do not match.");
      return;
    }
    const result = await sendMessage<boolean>({
      type: MessageTypes.ChangePassphrase,
      currentPassphrase: passphrase,
      newPassphrase,
    });
    setMessage(
      result.ok && result.data
        ? "Passphrase changed."
        : result.ok
          ? "Current passphrase is incorrect."
          : result.error,
    );
    if (result.ok && result.data) {
      setPassphrase("");
      setNewPassphrase("");
      setConfirm("");
    }
  };
  const exportBackup = async (encrypted: boolean) => {
    const backupPassphrase = passphrase;
    if (encrypted && backupPassphrase.length < 10) {
      setMessage("Enter a 10+ character backup passphrase first.");
      return;
    }
    if (
      !encrypted &&
      !window.confirm("Plain JSON can expose every saved field. Continue?")
    )
      return;
    const result = await sendMessage<string>({
      type: MessageTypes.ExportBackup,
      encrypted,
      passphrase: backupPassphrase,
    });
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    const blob = new Blob([result.data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `formsafe-${encrypted ? "encrypted" : "plain"}-${new Date().toISOString().slice(0, 10)}.${encrypted ? "formsafe" : "json"}`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Backup created.");
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    const contents = await file.text();
    const result = await sendMessage<ImportPreviewResponse>({
      type: MessageTypes.PreviewImport,
      contents,
      passphrase: passphrase || undefined,
    });
    if (result.ok) setPendingImport({ contents, preview: result.data });
    else setMessage(result.error);
  };
  const confirmImport = async () => {
    if (!pendingImport) return;
    const result = await sendMessage<{ imported: number }>({
      type: MessageTypes.ImportBackup,
      contents: pendingImport.contents,
      passphrase: passphrase || undefined,
    });
    setMessage(
      result.ok ? `Imported ${result.data.imported} sessions.` : result.error,
    );
    if (result.ok) {
      setPendingImport(undefined);
      await load();
    }
  };
  const usedPercent = stats
    ? Math.min(100, Math.round((stats.approximateBytes / stats.maxBytes) * 100))
    : 0;

  return (
    <main className="min-h-screen bg-mist text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-brand-600 text-white">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">{tr("optionsTitle")}</h1>
              <p className="text-sm text-slate-500">{tr("optionsSubtitle")}</p>
            </div>
          </div>
          <Badge tone="green">{tr("localFirstBadge")}</Badge>
        </div>
      </header>
      <section className="mx-auto grid max-w-5xl gap-4 px-5 py-5 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <Section title={tr("siteRules")} icon={<Globe2 className="size-4" />}>
            <p className="text-xs leading-5 text-slate-500">
              Granted origins: {origins.length || 0}. FormSafe never requests a
              new site silently.
            </p>
            <Button
              onClick={() =>
                chrome.tabs.create({
                  url: chrome.runtime.getURL("/onboarding.html"),
                })
              }
            >
              Manage site access
            </Button>
            <Setting label={tr("blacklist")} description={tr("blacklistDesc")}>
              <Textarea
                value={settings.siteBlacklist.join("\n")}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    siteBlacklist: event.target.value
                      .split(/\r?\n/)
                      .filter(Boolean),
                  })
                }
                onBlur={() => void save(settings)}
              />
            </Setting>
          </Section>
          <Section
            title={tr("privacy")}
            icon={<LockKeyhole className="size-4" />}
          >
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div>
                <strong className="block text-sm">Encrypted storage</strong>
                <span className="text-xs text-slate-500">
                  {security.enabled
                    ? security.locked
                      ? "Enabled · locked"
                      : "Enabled · unlocked"
                    : "Optional"}
                </span>
              </div>
              <Badge tone={security.enabled ? "green" : "neutral"}>
                {security.enabled ? "On" : "Off"}
              </Badge>
            </div>
            <Input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder={
                security.enabled
                  ? "Current passphrase"
                  : "New passphrase (10+ characters)"
              }
            />
            {!security.enabled ? (
              <Input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Confirm passphrase"
              />
            ) : null}
            <Button
              variant={security.enabled ? "danger" : "primary"}
              onClick={() => void toggleEncryption()}
            >
              {security.enabled ? "Disable encryption" : "Enable encryption"}
            </Button>
            {security.enabled && !security.locked ? (
              <Button
                variant="ghost"
                onClick={async () => {
                  await sendMessage({ type: MessageTypes.Lock });
                  await load();
                }}
              >
                Lock now
              </Button>
            ) : null}
            {security.enabled ? (
              <div className="grid gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <strong className="text-sm">Change passphrase</strong>
                <Input
                  type="password"
                  value={newPassphrase}
                  onChange={(event) => setNewPassphrase(event.target.value)}
                  placeholder="New passphrase (10+ characters)"
                />
                <Input
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="Confirm new passphrase"
                />
                <Button variant="ghost" onClick={() => void updatePassphrase()}>
                  Change passphrase
                </Button>
              </div>
            ) : null}
            <p className="text-xs leading-5 text-slate-500">
              A forgotten passphrase cannot be recovered. The key is retained
              only for the current browser session.
            </p>
          </Section>
          <Section title={tr("recovery")} icon={<Save className="size-4" />}>
            <Toggle
              checked={settings.autosaveEnabled}
              onChange={(value) => patch({ autosaveEnabled: value })}
              label={tr("enableAutosave")}
              description={tr("enableAutosaveDesc")}
            />
            <Toggle
              checked={settings.saveContentEditable}
              onChange={(value) => patch({ saveContentEditable: value })}
              label={tr("saveContentEditable")}
              description={tr("saveContentEditableDesc")}
            />
            <Toggle
              checked={settings.saveSafeControls}
              onChange={(value) => patch({ saveSafeControls: value })}
              label="Safe form controls"
              description="Select, checkbox and radio values outside sensitive forms."
            />
            <Toggle
              checked={settings.saveEmailFields}
              onChange={(value) => patch({ saveEmailFields: value })}
              label={tr("saveEmailFields")}
              description={tr("saveEmailFieldsDesc")}
            />
            <Setting label={tr("saveDelay")} description={tr("saveDelayDesc")}>
              <Input
                type="number"
                min={300}
                max={2500}
                value={settings.autosaveDelayMs}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    autosaveDelayMs: Number(event.target.value),
                  })
                }
                onBlur={() => void save(settings)}
              />
            </Setting>
            {settings.ignoredFieldRules.length ? (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <span className="text-xs text-slate-500">
                  {settings.ignoredFieldRules.length} ignored field rules
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => patch({ ignoredFieldRules: [] })}
                >
                  Clear rules
                </Button>
              </div>
            ) : null}
          </Section>
        </div>
        <div className="grid content-start gap-4">
          <Section
            title={tr("data")}
            icon={<Database className="size-4" />}
          >
            {stats ? (
              <>
                <div className="flex items-end justify-between">
                  <div>
                    <strong className="text-2xl tabular-nums">
                      {stats.sessions}
                    </strong>
                    <span className="ml-1 text-xs text-slate-500">
                      sessions
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {(stats.approximateBytes / 1024 / 1024).toFixed(2)} / 50 MB
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full bg-brand-600 transition-[width] duration-200"
                    style={{ width: `${usedPercent}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  {stats.versions} history checkpoints · automatic pruning
                  protects favorites.
                </p>
              </>
            ) : (
              <p className="text-xs text-slate-500">
                Unlock FormSafe to view storage.
              </p>
            )}
            <Input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="Backup passphrase"
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                icon={<Download className="size-4" />}
                onClick={() => void exportBackup(true)}
              >
                Encrypted backup
              </Button>
              <Button
                variant="ghost"
                icon={<Eye className="size-4" />}
                onClick={() => void exportBackup(false)}
              >
                Plain JSON
              </Button>
            </div>
            <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold transition-colors duration-150 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">
              <Upload className="size-4" />
              Import backup
              <input
                className="sr-only"
                type="file"
                accept=".json,.formsafe,application/json"
                onChange={(event) => void importFile(event.target.files?.[0])}
              />
            </label>
            <Button
              variant="danger"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                if (window.confirm("Delete every FormSafe session?")) {
                  await sendMessage({ type: MessageTypes.DeleteAllDrafts });
                  await load();
                }
              }}
            >
              Delete all sessions
            </Button>
          </Section>
          <Section title={tr("appearance")} icon={<Moon className="size-4" />}>
            <Setting label={tr("language")} description={tr("languageDesc")}>
              <Select
                value={settings.language}
                onChange={(event) =>
                  patch({ language: event.target.value as LanguageCode })
                }
              >
                {SUPPORTED_LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.nativeLabel} · {language.label}
                  </option>
                ))}
              </Select>
            </Setting>
            <Setting label={tr("theme")} description={tr("themeDesc")}>
              <Select
                value={settings.theme}
                onChange={(event) =>
                  patch({ theme: event.target.value as ThemeMode })
                }
              >
                <option value="system">{tr("themeSystem")}</option>
                <option value="light">{tr("themeLight")}</option>
                <option value="dark">{tr("themeDark")}</option>
              </Select>
            </Setting>
            <Toggle
              checked={settings.showRestorePopup}
              onChange={(value) => patch({ showRestorePopup: value })}
              label={tr("showRestorePopup")}
              description={tr("showRestorePopupDesc")}
            />
            <Toggle
              checked={settings.showSaveStatus}
              onChange={(value) => patch({ showSaveStatus: value })}
              label={tr("showSaveStatus")}
              description={tr("showSaveStatusDesc")}
            />
          </Section>
          <Card className="p-4">
            <h2 className="text-sm font-bold">{tr("privacy")}</h2>
            <ul className="mt-2 grid gap-1.5 text-xs leading-5 text-slate-500">
              <li>• {tr("privacySensitive")}</li>
              <li>• {tr("privacyChrome")}</li>
              <li>• {tr("privacyControl")}</li>
            </ul>
          </Card>
        </div>
      </section>
      {pendingImport ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-title"
        >
          <Card className="w-full max-w-md p-5">
            <h2 id="import-title" className="text-base font-bold">
              Review import
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Newer sessions win when IDs conflict. Nothing is changed until you
              confirm.
            </p>
            <dl className="my-4 grid grid-cols-2 gap-2 text-sm">
              <ImportStat label="Add" value={pendingImport.preview.added} />
              <ImportStat
                label="Update"
                value={pendingImport.preview.updated}
              />
              <ImportStat
                label="Keep current"
                value={pendingImport.preview.skipped}
              />
              <ImportStat
                label="Total after import"
                value={pendingImport.preview.totalAfterMerge}
              />
            </dl>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setPendingImport(undefined)}
              >
                Cancel
              </Button>
              <Button onClick={() => void confirmImport()}>
                Confirm import
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
      {message ? (
        <div
          role="status"
          className="fixed bottom-4 right-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          {message}
        </div>
      ) : null}
    </main>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <div className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-100">
          {icon}
        </div>
        <h2 className="text-sm font-bold">{title}</h2>
      </div>
      <div className="grid gap-3">{children}</div>
    </Card>
  );
}
function Setting({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span>
        <strong className="block text-sm">{label}</strong>
        <span className="text-xs leading-5 text-slate-500">{description}</span>
      </span>
      {children}
    </label>
  );
}
function ImportStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<OptionsApp />);
