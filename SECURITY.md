# Security Policy

## Privacy and Data Handling

FormSafe stores drafts locally with `chrome.storage.local`. It does not use a backend, AI service, analytics service, or external API for draft processing.

Security-sensitive behavior should stay conservative:

- Password fields must not be saved.
- Payment fields must not be saved.
- Token, API key, OTP, and secret fields must not be saved.
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

FormSafe is currently an MVP. Security fixes should target the main branch.
