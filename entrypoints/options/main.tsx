import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Download,
  Eraser,
  FileJson,
  Globe2,
  Moon,
  Save,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import '../../src/styles/global.css';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { ConfirmDialog } from '../../src/components/ConfirmDialog';
import { Input, Select, Textarea } from '../../src/components/Input';
import { Skeleton } from '../../src/components/Skeleton';
import { Toast, type ToastTone } from '../../src/components/Toast';
import { Toggle } from '../../src/components/Toggle';
import { getDomain } from '../../src/lib/format';
import { SUPPORTED_LANGUAGES, t } from '../../src/lib/i18n';
import { MessageTypes, sendMessage } from '../../src/lib/messages';
import { applyDocumentPreferences } from '../../src/lib/preferences';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/lib/settings';
import type { LanguageCode, Settings, TabContext, ThemeMode } from '../../src/types';

interface ToastState {
  message: string;
  tone: ToastTone;
}

interface OptionsAppProps {
  initialSettings: Settings;
}

function OptionsApp({ initialSettings }: OptionsAppProps) {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [tabContext, setTabContext] = useState<TabContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [blacklistText, setBlacklistText] = useState('');
  const [whitelistText, setWhitelistText] = useState('');
  const [confirmAction, setConfirmAction] = useState<'delete-all' | 'delete-site' | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const language = settings.language;
  const currentSiteLabel = useMemo(
    () => (tabContext?.isSupported ? getDomain(tabContext.origin) : t(language, 'unavailablePage')),
    [language, tabContext],
  );

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
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    const load = async () => {
      const [settingsResponse, tabResponse] = await Promise.all([
        sendMessage<Settings>({ type: MessageTypes.GetSettings }),
        sendMessage<TabContext>({ type: MessageTypes.GetTabContext }),
      ]);

      if (settingsResponse.ok) {
        const normalized = normalizeSettings(settingsResponse.data);
        setSettings(normalized);
        setBlacklistText(normalized.siteBlacklist.join('\n'));
        setWhitelistText(normalized.siteWhitelist.join('\n'));
      } else {
        showToast(settingsResponse.error, 'error');
      }

      if (tabResponse.ok) setTabContext(tabResponse.data);
      setLoading(false);
    };

    void load();
  }, [showToast]);

  const persistSettings = async (nextSettings: Settings, successMessage = t(language, 'settingsSaved')) => {
    setSaving(true);
    const normalized = normalizeSettings(nextSettings);
    const response = await sendMessage<boolean>({ type: MessageTypes.SaveSettings, settings: normalized });
    setSaving(false);

    if (response.ok && response.data) {
      setSettings(normalized);
      setBlacklistText(normalized.siteBlacklist.join('\n'));
      setWhitelistText(normalized.siteWhitelist.join('\n'));
      showToast(successMessage, 'success');
      return;
    }

    showToast(response.ok ? t(language, 'settingsSaveFailed') : response.error, 'error');
  };

  const patchSettings = (patch: Partial<Settings>, message?: string) => {
    void persistSettings({ ...settings, ...patch }, message);
  };

  const saveSiteRules = () => {
    patchSettings(
      {
        siteBlacklist: linesToRules(blacklistText),
        siteWhitelist: linesToRules(whitelistText),
      },
      t(language, 'rulesSaved'),
    );
  };

  const exportJson = async () => {
    const response = await sendMessage<string>({ type: MessageTypes.ExportDrafts });
    if (!response.ok) {
      showToast(response.error, 'error');
      return;
    }

    const blob = new Blob([response.data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `formsafe-drafts-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast(t(language, 'exportCreated'), 'success');
  };

  const deleteAllDrafts = async () => {
    const response = await sendMessage<boolean>({ type: MessageTypes.DeleteAllDrafts });
    setConfirmAction(null);
    showToast(
      response.ok && response.data ? t(language, 'allDraftsDeleted') : response.ok ? t(language, 'deleteFailed') : response.error,
      response.ok && response.data ? 'success' : 'error',
    );
  };

  const deleteCurrentSiteDrafts = async () => {
    if (!tabContext?.isSupported) return;
    const response = await sendMessage<boolean>({
      type: MessageTypes.DeleteDraftsForOrigin,
      origin: tabContext.origin,
    });
    setConfirmAction(null);
    showToast(
      response.ok && response.data
        ? t(language, 'siteDraftsDeleted', { site: currentSiteLabel })
        : response.ok
          ? t(language, 'deleteFailed')
          : response.error,
      response.ok && response.data ? 'success' : 'error',
    );
  };

  return (
    <main className="min-h-screen bg-mist text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/95 px-6 py-5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-xl bg-brand-600 text-white shadow-soft">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{t(language, 'optionsTitle')}</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">{t(language, 'optionsSubtitle')}</p>
            </div>
          </div>
          <Badge tone="green">{t(language, 'localFirstBadge')}</Badge>
        </div>
      </header>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 py-6 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-4">
          {loading ? (
            <>
              <Skeleton className="h-56" />
              <Skeleton className="h-64" />
            </>
          ) : (
            <>
              <SettingsSection title={t(language, 'appearance')} icon={<Moon className="size-4" />}>
                <SettingRow label={t(language, 'language')} description={t(language, 'languageDesc')}>
                  <Select
                    value={settings.language}
                    onChange={(event) => patchSettings({ language: event.target.value as LanguageCode })}
                  >
                    {SUPPORTED_LANGUAGES.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.nativeLabel} · {item.label}
                      </option>
                    ))}
                  </Select>
                </SettingRow>
                <SettingRow label={t(language, 'theme')} description={t(language, 'themeDesc')}>
                  <Select
                    value={settings.theme}
                    onChange={(event) => patchSettings({ theme: event.target.value as ThemeMode })}
                  >
                    <option value="system">{t(language, 'themeSystem')}</option>
                    <option value="light">{t(language, 'themeLight')}</option>
                    <option value="dark">{t(language, 'themeDark')}</option>
                  </Select>
                </SettingRow>
              </SettingsSection>

              <SettingsSection title={t(language, 'autosave')} icon={<SettingsIcon className="size-4" />}>
                <Toggle
                  checked={settings.autosaveEnabled}
                  onChange={(checked) => patchSettings({ autosaveEnabled: checked })}
                  label={t(language, 'enableAutosave')}
                  description={t(language, 'enableAutosaveDesc')}
                />
                <SettingRow label={t(language, 'saveDelay')} description={t(language, 'saveDelayDesc')}>
                  <Input
                    type="number"
                    min={300}
                    max={2500}
                    step={50}
                    value={settings.autosaveDelayMs}
                    onChange={(event) => setSettings({ ...settings, autosaveDelayMs: Number(event.target.value) })}
                    onBlur={() => void persistSettings(settings)}
                  />
                </SettingRow>
                <SettingRow label={t(language, 'minCharacters')} description={t(language, 'minCharactersDesc')}>
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={settings.minCharacters}
                    onChange={(event) => setSettings({ ...settings, minCharacters: Number(event.target.value) })}
                    onBlur={() => void persistSettings(settings)}
                  />
                </SettingRow>
                <Toggle
                  checked={settings.saveContentEditable}
                  onChange={(checked) => patchSettings({ saveContentEditable: checked })}
                  label={t(language, 'saveContentEditable')}
                  description={t(language, 'saveContentEditableDesc')}
                />
                <Toggle
                  checked={settings.saveEmailFields}
                  onChange={(checked) => patchSettings({ saveEmailFields: checked })}
                  label={t(language, 'saveEmailFields')}
                  description={t(language, 'saveEmailFieldsDesc')}
                />
              </SettingsSection>

              <SettingsSection title={t(language, 'recovery')} icon={<Save className="size-4" />}>
                <Toggle
                  checked={settings.showRestorePopup}
                  onChange={(checked) => patchSettings({ showRestorePopup: checked })}
                  label={t(language, 'showRestorePopup')}
                  description={t(language, 'showRestorePopupDesc')}
                />
                <Toggle
                  checked={settings.showSaveStatus}
                  onChange={(checked) => patchSettings({ showSaveStatus: checked })}
                  label={t(language, 'showSaveStatus')}
                  description={t(language, 'showSaveStatusDesc')}
                />
              </SettingsSection>

              <SettingsSection title={t(language, 'siteRules')} icon={<Globe2 className="size-4" />}>
                <Toggle
                  checked={settings.whitelistMode}
                  onChange={(checked) => patchSettings({ whitelistMode: checked })}
                  label={t(language, 'whitelistMode')}
                  description={t(language, 'whitelistModeDesc')}
                />
                <SettingRow label={t(language, 'blacklist')} description={t(language, 'blacklistDesc')}>
                  <Textarea value={blacklistText} onChange={(event) => setBlacklistText(event.target.value)} placeholder="https://example.com" />
                </SettingRow>
                <SettingRow label={t(language, 'whitelist')} description={t(language, 'whitelistDesc')}>
                  <Textarea value={whitelistText} onChange={(event) => setWhitelistText(event.target.value)} placeholder="app.example.com" />
                </SettingRow>
                <Button variant="secondary" icon={<Save className="size-4" />} onClick={saveSiteRules} disabled={saving}>
                  {t(language, 'saveRules')}
                </Button>
              </SettingsSection>
            </>
          )}
        </div>

        <aside className="grid content-start gap-4">
          <SettingsSection title={t(language, 'data')} icon={<FileJson className="size-4" />}>
            <SettingRow label={t(language, 'deleteOldDrafts')} description={t(language, 'deleteOldDraftsDesc')}>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  value={settings.autoDeleteDays}
                  onChange={(event) => setSettings({ ...settings, autoDeleteDays: Number(event.target.value) })}
                  onBlur={() => void persistSettings(settings)}
                />
                <span className="text-xs text-slate-600 dark:text-slate-400">{t(language, 'days')}</span>
              </div>
            </SettingRow>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportJson}>
              {t(language, 'exportJson')}
            </Button>
            <Button
              variant="danger"
              icon={<Eraser className="size-4" />}
              onClick={() => setConfirmAction('delete-site')}
              disabled={!tabContext?.isSupported}
            >
              {t(language, 'deleteForSite', { site: currentSiteLabel })}
            </Button>
            <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirmAction('delete-all')}>
              {t(language, 'deleteAllDrafts')}
            </Button>
          </SettingsSection>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-950 dark:text-white">{t(language, 'privacy')}</h2>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-700 dark:text-slate-300">
              <li>{t(language, 'privacyChrome')}</li>
              <li>{t(language, 'privacySensitive')}</li>
              <li>{t(language, 'privacyControl')}</li>
            </ul>
          </Card>
        </aside>
      </section>

      <ConfirmDialog
        open={confirmAction === 'delete-all'}
        title={t(language, 'deleteAllTitle')}
        description={t(language, 'deleteAllDesc')}
        confirmLabel={t(language, 'deleteAllConfirm')}
        cancelLabel={t(language, 'cancel')}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void deleteAllDrafts()}
      />
      <ConfirmDialog
        open={confirmAction === 'delete-site'}
        title={t(language, 'deleteSiteTitle', { site: currentSiteLabel })}
        description={t(language, 'deleteSiteDesc')}
        confirmLabel={t(language, 'delete')}
        cancelLabel={t(language, 'cancel')}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void deleteCurrentSiteDrafts()}
      />
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </main>
  );
}

function SettingsSection({
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
        <div className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-100">{icon}</div>
        <h2 className="text-sm font-bold text-slate-950 dark:text-white">{title}</h2>
      </div>
      <div className="grid gap-4">{children}</div>
    </Card>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span>
        <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-600 dark:text-slate-400">{description}</span>
      </span>
      {children}
    </label>
  );
}

function linesToRules(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

void bootstrap();

async function bootstrap(): Promise<void> {
  const initialSettings = await loadInitialSettings();
  applyDocumentPreferences(initialSettings);
  createRoot(document.getElementById('root')!).render(<OptionsApp initialSettings={initialSettings} />);
}

async function loadInitialSettings(): Promise<Settings> {
  const response = await sendMessage<Settings>({ type: MessageTypes.GetSettings });
  return response.ok ? response.data : DEFAULT_SETTINGS;
}
