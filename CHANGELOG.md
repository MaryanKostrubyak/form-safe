# Changelog

All notable changes to this project will be documented in this file.

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
