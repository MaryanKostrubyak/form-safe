# Security Policy

## Privacy and Data Handling

FormSafe stores form sessions locally in IndexedDB. Settings and technical metadata use `storage.local`. It does not use a backend, cloud sync, AI service, telemetry, analytics, or an external API for form processing.

Security-sensitive behavior should stay conservative:

- Password fields must not be saved.
- Payment fields must not be saved.
- Token, API key, OTP, PIN, SSN, IBAN, passport, recovery phrase, and secret fields must not be saved.
- A form containing a credential or payment field must be blocked as a whole by default.
- Restore must match the exact origin, path, frame, and form signature.
- Encryption keys must remain in `storage.session`, never persistent storage.
- Draft export and deletion controls should remain easy to find.
- New permissions should be avoided unless they are required for core functionality.

## Reporting Issues

If you find a privacy or security issue, please open a GitHub issue without including private draft content, credentials, tokens, or personally sensitive data.

Include:

- A short description of the issue
- Steps to reproduce
- Affected browser and OS
- Whether sensitive field detection was involved

## Supported Versions

Security fixes target the current 2.x release line.
