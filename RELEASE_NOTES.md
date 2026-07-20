# FormSafe 2.0.0

FormSafe 2.0 changes draft recovery from a collection of separate fields into complete form sessions. A session keeps the fields that belong together, up to ten meaningful versions, and enough page information to restore data only to the matching form.

## What is new

- Complete form recovery for text fields, textareas, email and search inputs, contenteditable editors, selects, checkboxes, and radio buttons
- A version timeline with restore-all, restore-version, and restore-selected-field actions
- Local IndexedDB storage with serialized writes, pagination, storage limits, and favorite-safe cleanup
- Optional AES-256-GCM encryption with a session-only key and manual lock
- Encrypted `.formsafe` backups and validated JSON import with a conflict preview
- Support for iframes, open Shadow DOM, ProseMirror, Quill, Lexical, TinyMCE, and CodeMirror 6
- A compact Chrome Side Panel, updated popup and settings, keyboard commands, and context-menu actions

## Privacy and access

FormSafe still has no account, server, cloud sync, analytics, or telemetry. Drafts remain on the device. Passwords, payment credentials, tokens, one-time codes, recovery phrases, and other sensitive fields are never saved.

Site access is now optional. During setup, you can allow FormSafe on all websites or only the site you are using. Chrome asks for that permission only after you make a selection.

## Reliability fixes

- Setup no longer repeats when Chrome already granted the selected access
- Language changes are saved and reflected across open extension views
- Autosave starts immediately on tabs that were open before access was granted
- Ordinary hidden and file controls no longer prevent safe fields in the same form from being saved
- **Open Drafts** opens the Side Panel from the original click and closes the popup once the panel is ready
- Clearing a field does not remove the last useful non-empty version

## Updating from 1.0

Existing drafts are migrated automatically on first start. FormSafe writes and verifies the new sessions before removing the legacy records. Existing Chrome permissions are preserved when Chrome reports them as granted.

If the drafts are important, create a backup before replacing the extension files. Encryption is optional and can be enabled later in **Settings → Privacy & Encryption**. Keep the passphrase safe: it cannot be recovered.

## Install

Download `formsafe-2.0.0-chrome.zip`, extract it, open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select the extracted folder.

Chrome 116 or newer is required. Firefox is not included in this release.
