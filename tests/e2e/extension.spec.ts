import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let context: BrowserContext;
let extensionId = "";

test.beforeAll(async () => {
  const profilePath = await mkdtemp(join(tmpdir(), "formsafe-e2e-"));
  const extensionPath = join(profilePath, "extension");
  await cp(resolve(".output/chrome-mv3"), extensionPath, { recursive: true });
  const manifestPath = join(extensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
    string,
    unknown
  >;
  manifest.host_permissions = ["*://*/*"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profilePath, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent("serviceworker");
  extensionId = new URL(worker.url()).host;
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (
          await chrome.scripting.getRegisteredContentScripts({
            ids: ["formsafe-runtime-content"],
          })
        ).length,
      ),
    )
    .toBe(1);
});

test.afterAll(async () => context.close());

test("onboarding recognizes access Chrome already granted", async () => {
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/onboarding.html?origin=${encodeURIComponent("http://127.0.0.1:4173")}`,
  );
  await expect(
    page.getByRole("heading", { name: "Where should autosave run?" }),
  ).toBeVisible();
  await page.getByLabel("All websites").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Optional encrypted storage" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Finish setup" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("checkbox", { name: "Encrypt saved forms" }),
  ).toBeFocused();
  const outline = await page
    .getByRole("checkbox", { name: "Encrypt saved forms" })
    .evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
  await page.close();
});

test("onboarding explains how to recover when Chrome remembers a permission denial", async () => {
  const profilePath = await mkdtemp(join(tmpdir(), "formsafe-denied-e2e-"));
  const extensionPath = join(profilePath, "extension");
  await cp(resolve(".output/chrome-mv3"), extensionPath, { recursive: true });
  const deniedContext = await chromium.launchPersistentContext(profilePath, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  let worker = deniedContext.serviceWorkers()[0];
  worker ??= await deniedContext.waitForEvent("serviceworker");
  const deniedExtensionId = new URL(worker.url()).host;
  const page = await deniedContext.newPage();
  await page.addInitScript(() => {
    chrome.permissions.contains = async () => false;
    chrome.permissions.request = async () => false;
  });
  await page.goto(`chrome-extension://${deniedExtensionId}/onboarding.html`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Chrome did not grant site access",
  );
  await expect(
    page.getByRole("button", { name: "Open Chrome access settings" }),
  ).toBeVisible();
  await deniedContext.close();
});

test("starts saving on an already open website immediately after access is granted", async () => {
  const profilePath = await mkdtemp(join(tmpdir(), "formsafe-live-access-e2e-"));
  const extensionPath = join(profilePath, "extension");
  await cp(resolve(".output/chrome-mv3"), extensionPath, { recursive: true });
  const manifestPath = join(extensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
    string,
    unknown
  >;
  manifest.host_permissions = ["*://*/*"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  const liveContext = await chromium.launchPersistentContext(profilePath, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  let worker = liveContext.serviceWorkers()[0];
  worker ??= await liveContext.waitForEvent("serviceworker");
  const liveExtensionId = new URL(worker.url()).host;
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (
          await chrome.scripting.getRegisteredContentScripts({
            ids: ["formsafe-runtime-content"],
          })
        ).length,
      ),
    )
    .toBe(1);
  await worker.evaluate(() =>
    chrome.scripting.unregisterContentScripts({
      ids: ["formsafe-runtime-content"],
    }),
  );

  const fixture = await liveContext.newPage();
  await fixture.goto("http://127.0.0.1:4173/tests/e2e/fixtures/form-lab.html");
  await expect(fixture.locator("#message")).not.toHaveAttribute(
    "data-formsafe-tracked",
    "true",
  );

  const onboarding = await liveContext.newPage();
  await onboarding.goto(`chrome-extension://${liveExtensionId}/onboarding.html`);
  await onboarding.getByRole("button", { name: "Continue" }).click();
  await expect(
    onboarding.getByRole("heading", { name: "Optional encrypted storage" }),
  ).toBeVisible();
  await expect(fixture.locator("#message")).toHaveAttribute(
    "data-formsafe-tracked",
    "true",
  );
  await liveContext.close();
});

test("does not confuse an unsupported Chrome page with missing site access", async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(
    popup.getByRole("heading", { name: "Page unavailable" }),
  ).toBeVisible();
  await expect(
    popup.getByRole("heading", { name: "Choose where FormSafe works" }),
  ).toHaveCount(0);
  await popup.close();
});

test("applies and persists the selected interface language", async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel("Language").selectOption("uk");
  await expect(
    options.getByRole("heading", { name: "Налаштування FormSafe" }),
  ).toBeVisible();
  await expect(options.getByRole("status")).toHaveText(
    "Налаштування збережено.",
  );

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(
    popup.getByRole("heading", { name: "Сторінка недоступна" }),
  ).toBeVisible();
  await popup.close();

  await options.reload();
  await expect(
    options.getByRole("heading", { name: "Налаштування FormSafe" }),
  ).toBeVisible();

  await options.getByLabel("Мова").selectOption("en");
  await expect(
    options.getByRole("heading", { name: "FormSafe settings" }),
  ).toBeVisible();
  await expect(options.getByRole("status")).toHaveText("Settings saved.");
  await options.close();
});

test("captures standard, controlled, iframe, shadow and rich editor forms", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/tests/e2e/fixtures/form-lab.html");
  await expect(page.locator("#message")).toHaveAttribute(
    "data-formsafe-tracked",
    "true",
  );
  await page.locator("#message").fill("Standard draft");
  await page.locator("#controlled").fill("Controlled draft");
  await page.locator(".ProseMirror").fill("Rich draft");
  await page
    .locator("#shadow-host")
    .evaluate(
      (host) =>
        ((
          host.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement
        ).value = "Shadow draft"),
    );
  const frame = page.frameLocator("iframe");
  await frame.locator("textarea").fill("Frame draft");
  await page.waitForTimeout(1_200);

  await page.locator("#message").fill("");
  const restoreControl = page.getByRole("button", {
    name: "Restore saved form",
  });
  await expect(restoreControl).toBeVisible();
  await restoreControl.click();
  await expect(page.locator("#message")).toHaveValue("Standard draft");

  const sidepanel = await context.newPage();
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(sidepanel.getByText("Form sessions")).toBeVisible();
  await expect(
    sidepanel
      .getByText(/Standard draft|Controlled draft|Rich draft|Frame draft/)
      .first(),
  ).toBeVisible();
  const storedSessions = await sidepanel.evaluate(
    () =>
      chrome.runtime.sendMessage({
        type: "formsafe:v2-query-sessions",
        query: { origin: "http://127.0.0.1:4173", limit: 50 },
      }) as Promise<unknown>,
  );
  expect(JSON.stringify(storedSessions)).not.toContain("fixture-token");
  await sidepanel.close();
  await page.close();
});

test("utility UI respects reduced motion and has stable light/dark layouts", async () => {
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.setViewportSize({ width: 640, height: 760 });
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
  const duration = await page
    .locator("button")
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.00001);
  await expect(page).toHaveScreenshot("onboarding-light-wide.png", {
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 760 });
  await expect(page).toHaveScreenshot("onboarding-dark-narrow.png", {
    fullPage: true,
  });
  await page.close();

  const options = await context.newPage();
  await options.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await options.setViewportSize({ width: 1100, height: 820 });
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(
    options.getByRole("heading", { name: "FormSafe settings" }),
  ).toBeVisible();
  await expect(options).toHaveScreenshot("settings-light-wide.png", {
    fullPage: true,
  });
  await options.close();

  const sidepanel = await context.newPage();
  await sidepanel.emulateMedia({
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  await sidepanel.setViewportSize({ width: 420, height: 800 });
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(
    sidepanel.getByRole("heading", { name: "FormSafe" }),
  ).toBeVisible();
  await expect(sidepanel.locator('[data-testid="session-card"]')).toHaveCount(
    3,
  );
  await expect(sidepanel).toHaveScreenshot("sidepanel-dark-narrow.png", {
    fullPage: true,
  });
  await sidepanel.close();

  const fixture = await context.newPage();
  await fixture.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await fixture.setViewportSize({ width: 520, height: 420 });
  await fixture.goto("http://127.0.0.1:4173/tests/e2e/fixtures/form-lab.html");
  await fixture.locator("#message").focus();
  await expect(fixture.locator("html > div").last()).toBeAttached();
  await expect(fixture).toHaveScreenshot("restore-widget-light.png", {
    clip: { x: 0, y: 0, width: 520, height: 300 },
  });
  await fixture.emulateMedia({ colorScheme: "dark" });
  await expect(fixture).toHaveScreenshot("restore-widget-dark.png", {
    clip: { x: 0, y: 0, width: 520, height: 300 },
  });

  const popup = await context.newPage();
  await popup.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await popup.setViewportSize({ width: 360, height: 620 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(
    popup.getByRole("heading", { name: "FormSafe", exact: true }),
  ).toBeVisible();
  await expect(
    popup.getByRole("heading", { name: "Page unavailable" }),
  ).toBeVisible();
  await expect(popup).toHaveScreenshot("popup-light-narrow.png", {
    fullPage: true,
  });
  await popup.close();
  await fixture.close();
});
