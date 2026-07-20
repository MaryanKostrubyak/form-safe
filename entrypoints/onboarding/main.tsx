import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { Check, Globe2, LockKeyhole, ShieldCheck } from "lucide-react";
import "../../src/styles/global.css";
import { Button } from "../../src/components/Button";
import { Card } from "../../src/components/Card";
import { Input } from "../../src/components/Input";
import { MessageTypes, sendMessage } from "../../src/lib/messages";
import { applyDocumentPreferences } from "../../src/lib/preferences";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";
import type { Settings } from "../../src/types";
import {
  ensureHostAccess,
  hostPatternsForMode,
} from "../../src/lib/v2/host-access";

function OnboardingApp() {
  const [step, setStep] = useState(1);
  const [origin, setOrigin] = useState("");
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [encrypt, setEncrypt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    const requestedOrigin = new URLSearchParams(location.search).get("origin");
    if (requestedOrigin) setOrigin(requestedOrigin);
    void Promise.all([
      sendMessage<Settings>({ type: MessageTypes.GetSettings }),
      sendMessage({ type: MessageTypes.GetTabContext }),
    ]).then(([settings, context]) => {
      if (settings.ok) applyDocumentPreferences(settings.data);
      else applyDocumentPreferences(DEFAULT_SETTINGS);
      if (
        !requestedOrigin &&
        context.ok &&
        typeof context.data === "object" &&
        context.data &&
        "origin" in context.data
      )
        setOrigin(String(context.data.origin || ""));
    });
  }, []);

  const grant = async () => {
    setBusy(true);
    setError("");
    setPermissionDenied(false);
    const origins = hostPatternsForMode(mode, origin);
    const access = await ensureHostAccess(chrome.permissions, origins);
    const result = access.granted
      ? await sendMessage<boolean>({
          type: MessageTypes.ConfirmHostAccess,
          mode,
        })
      : { ok: true as const, data: false };
    setBusy(false);
    if (result.ok && result.data) setStep(2);
    else if (!access.granted && access.reason === "error")
      setError(`Chrome could not request access: ${access.error}`);
    else {
      setPermissionDenied(true);
      setError(
        "Chrome did not grant site access. Choose Allow in Chrome's permission dialog. If the dialog no longer appears, restore access in the extension settings below.",
      );
    }
  };
  const finish = async () => {
    setError("");
    if (encrypt) {
      if (passphrase.length < 10) {
        setError("Use at least 10 characters.");
        return;
      }
      if (passphrase !== confirm) {
        setError("Passphrases do not match.");
        return;
      }
      setBusy(true);
      const result = await sendMessage<boolean>({
        type: MessageTypes.EnableEncryption,
        passphrase,
      });
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
    }
    const settingsResult = await sendMessage<Settings>({
      type: MessageTypes.GetSettings,
    });
    if (settingsResult.ok)
      await sendMessage({
        type: MessageTypes.SaveSettings,
        settings: {
          ...settingsResult.data,
          onboardingComplete: true,
          hostAccessMode: mode,
        },
      });
    window.close();
  };

  return (
    <main className="min-h-screen bg-mist px-5 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-xl">
        <header className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-brand-600 text-white">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Set up FormSafe</h1>
            <p className="text-sm text-slate-500">
              Two choices, then FormSafe stays out of your way.
            </p>
          </div>
        </header>
        <div className="mt-6 flex items-center gap-2 text-xs font-semibold">
          <span
            className={`grid size-6 place-items-center rounded-full ${step >= 1 ? "bg-brand-600 text-white" : "bg-slate-200"}`}
          >
            {step > 1 ? <Check className="size-3.5" /> : "1"}
          </span>
          <span>Site access</span>
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          <span
            className={`grid size-6 place-items-center rounded-full ${step >= 2 ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-500"}`}
          >
            2
          </span>
          <span>Encryption</span>
        </div>
        {step === 1 ? (
          <Card className="mt-5 p-5">
            <Globe2 className="size-5 text-brand-600" />
            <h2 className="mt-3 text-base font-bold">
              Where should autosave run?
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
            Chrome will show the permission prompt only after your selection.
            </p>
            <div className="mt-4 grid gap-2">
              <label
                className={`cursor-pointer rounded-lg border p-3 ${mode === "all" ? "border-brand-600 bg-brand-50 dark:bg-brand-950/20" : "border-slate-200 dark:border-slate-800"}`}
              >
                <input
                  className="mr-2"
                  type="radio"
                  checked={mode === "all"}
                  onChange={() => setMode("all")}
                />
                All websites
              </label>
              <label
                className={`cursor-pointer rounded-lg border p-3 ${mode === "selected" ? "border-brand-600 bg-brand-50 dark:bg-brand-950/20" : "border-slate-200 dark:border-slate-800"}`}
              >
                <input
                  className="mr-2"
                  type="radio"
                  checked={mode === "selected"}
                  onChange={() => setMode("selected")}
                />
                Only the current website
              </label>
            </div>
            {mode === "selected" ? (
              <Input
                className="mt-3"
                value={origin}
                onChange={(event) => setOrigin(event.target.value)}
                placeholder="https://example.com"
              />
            ) : null}
            <Button
              className="mt-4 w-full"
              variant="primary"
              disabled={busy}
              onClick={() => void grant()}
            >
              {busy ? "Requesting…" : "Continue"}
            </Button>
          </Card>
        ) : (
          <Card className="mt-5 p-5">
            <LockKeyhole className="size-5 text-brand-600" />
            <h2 className="mt-3 text-base font-bold">
              Optional encrypted storage
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              With encryption enabled, drafts unlock once per browser session. A
              forgotten passphrase cannot be recovered.
            </p>
            <label className="mt-4 flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <span>
                <strong className="block text-sm">Encrypt saved forms</strong>
                <span className="text-xs text-slate-500">
                  AES-GCM, local only
                </span>
              </span>
              <input
                type="checkbox"
                checked={encrypt}
                onChange={(event) => setEncrypt(event.target.checked)}
              />
            </label>
            {encrypt ? (
              <div className="mt-3 grid gap-2">
                <Input
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  placeholder="Passphrase (10+ characters)"
                />
                <Input
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="Confirm passphrase"
                />
              </div>
            ) : null}
            <Button
              className="mt-4 w-full"
              variant="primary"
              disabled={busy}
              onClick={() => void finish()}
            >
              {busy ? "Securing drafts…" : "Finish setup"}
            </Button>
          </Card>
        )}
        {error ? (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
            <p role="alert">{error}</p>
            {permissionDenied ? (
              <Button
                className="mt-3"
                size="sm"
                onClick={() =>
                  chrome.tabs.create({
                    url: `chrome://extensions/?id=${chrome.runtime.id}`,
                  })
                }
              >
                Open Chrome access settings
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<OnboardingApp />);
