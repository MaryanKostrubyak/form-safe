# FormSafe 2.0

FormSafe is a local-first Chrome extension that saves complete form sessions and restores them only to the exact matching page and form. There is no account, backend, cloud sync, AI, telemetry, or analytics.

## Install

1. Download `formsafe-2.0.0-chrome.zip` from the latest GitHub Release.
2. Extract the archive to a permanent folder.
3. Open `chrome://extensions` in Chrome and enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder.

When updating an unpacked copy, replace the extracted files and select **Reload** on the Chrome extensions page.

## What 2.0 saves

- Complete form sessions: text, textarea, email, search, contenteditable, select, checkbox, and radio fields.
- Up to 10 meaningful checkpoints per form, including clear, idle, restore, submit, page-hide, and manual checkpoints.
- Page origin/path, frame URL, and stable form/field signatures used for strict restore targeting.
- Favorite, archive/completion state, restore count, and timestamps.

The content script sends captures to the background worker. All session writes pass through one serialized IndexedDB repository; settings and technical metadata remain in `storage.local` with trusted-context access where the browser supports it.

## Privacy and encryption

FormSafe never saves password, hidden, file, payment credential, token, OTP, PIN, SSN, IBAN, passport, API-key, or recovery-phrase fields. If a form contains one of these fields, the complete form is blocked by default. A field or site can be ignored explicitly, but blocked credential fields cannot be enabled.

Optional encryption uses AES-256-GCM with a unique IV for every record. The key is derived with PBKDF2-SHA-256 and a random salt. Only the derived key is kept in `storage.session`; after a browser restart, FormSafe remains locked until the passphrase is entered. Forgotten passphrases cannot be recovered.

Encrypted `.formsafe` files are the recommended backup. Plain JSON export is a separate action with a privacy warning. Import validates schema, file size, record count, and encrypted envelopes, then presents a newer-wins merge preview before changing storage.

## Permissions

FormSafe does not require `<all_urls>` at install time. Onboarding explains and requests either all HTTP(S) sites or the selected site after an explicit user action. Runtime content scripts follow permission grants and revocations.

Required API permissions are `storage`, `activeTab`, `scripting`, and `contextMenus`. Chrome also receives `sidePanel` from the WXT side-panel entrypoint.

## Recovery UI

- Search and server-side pagination with site, status, and favorite filters.
- Expandable sessions, fields, and a 10-version timeline.
- Restore all, one version, or one selected field.
- Copy, checkpoint, favorite, complete, archive, delete, and open-page actions.
- A field restore control, context-menu actions, and browser commands.
- Locked, permission-required, paused, active, quota, migration, loading, empty, and error states.

Open Shadow DOM, same-permission iframes, ProseMirror, Quill, Lexical, TinyMCE, and CodeMirror 6 are supported. Closed Shadow DOM and Monaco cannot be observed reliably and are not reported as saved.

## Browser support

- Chrome 116+
FormSafe uses the native Chrome Side Panel for recovery.

## Development

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test:coverage
pnpm build
pnpm test:e2e
pnpm zip
```

`pnpm release:check` runs type checking, lint, unit/integration coverage, the Chrome production build, browser tests, and release packaging. Chromium E2E fixtures cover standard forms, controlled inputs, SPA-ready navigation, iframes, open Shadow DOM, and supported editor shapes. Visual snapshots cover light/dark and narrow/wide layouts, including reduced motion.

Generated unpacked folders:

- `.output/chrome-mv3`

## Storage limits and migration

FormSafe limits itself to approximately 50 MB or 2,000 sessions. Pruning starts with the oldest non-favorite completed/archived sessions and never removes favorites automatically.

On first 2.0 start, legacy field drafts are grouped by origin, path, and form signature, written as v2 sessions with a migration checkpoint, read back for verification, and only then removed from legacy storage.

## Backup format

Backup schema version is `2`. Plain backups use `kind: "formsafe-backup"`; encrypted backups use `kind: "formsafe-encrypted-backup"` with PBKDF2 metadata and an AES-GCM payload. Imports are limited to 2,000 sessions and approximately 51 MB.

## License

MIT. See [LICENSE](./LICENSE).
