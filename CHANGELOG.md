# Changelog

All notable changes to this project will be documented in this file.

## 2.0.0 - 2026-07-20

### Added

- Full-form sessions with 10-version checkpoint history and selected-field/version restore
- IndexedDB repository with a serialized background write queue, pagination, statistics, and favorite-safe pruning
- Optional AES-256-GCM encryption, session-only keys, manual lock, passphrase rotation, and transactional storage conversion
- Encrypted backups plus validated v2 JSON import with a merge preview
- Two-step permission/encryption onboarding and runtime host-permission synchronization
- Select, checkbox, radio, open Shadow DOM, iframe, and common rich-editor support
- Chrome Side Panel, browser commands, and context-menu actions
- Chromium E2E fixtures, visual snapshots, and unit/integration coverage gates

### Changed

- Replaced required broad host access with optional HTTP(S) host permissions
- Rebuilt popup, recovery panel, settings, onboarding, and field controls in a compact utility design
- Updated WXT/Vite-related tooling and moved build-only dependencies to development dependencies
- Changed the primary backup format to encrypted `.formsafe` files

### Fixed

- Existing Chrome site permissions are now recognized during onboarding instead of showing setup repeatedly
- Language changes persist immediately and refresh every open FormSafe view
- Autosave starts on already open tabs after access is granted and no longer stalls on ordinary hidden or file controls
- The Open Drafts button now opens the Chrome Side Panel from the original user click and closes the popup after the panel is ready
- Save status messages now explain when a form is skipped, locked, sensitive, or contains no eligible fields

### Security

- Expanded tokenized sensitive-field detection and blocked entire sensitive forms by default
- Restricted `storage.local` to trusted extension contexts where supported
- Restore now resolves session data in the background and requires exact origin, path, frame, and form signatures

## 1.0.0 - 2026-05-31

First public release of FormSafe.

### Added

- Automatic local draft autosave for supported form fields
- One-click restore widget for matching saved drafts
- Side panel for browsing, searching, restoring, exporting, and deleting drafts
- Per-site autosave pause controls
- Sensitive field filtering for passwords, cards, tokens, and OTP-like inputs
- GitHub release workflow with build artifact upload on version tags

### Changed

- Project metadata improved for GitHub discoverability
- Manifest version now follows `package.json` automatically to avoid version drift

## 0.1.0

Initial MVP:

- Local form draft autosave
- Restore widget for matching drafts
- Chrome Side Panel draft manager
- Popup with current site status
- Options page for autosave, privacy, language, and theme settings
- Sensitive field filtering
- Local export and delete controls
