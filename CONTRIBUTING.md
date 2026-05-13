# Contributing to FormSafe

Thanks for taking the time to improve FormSafe.

FormSafe is a privacy-first browser productivity tool. Contributions should keep the product local-first, simple, and trustworthy.

## Development Setup

```bash
pnpm install
pnpm dev
```

For production checks:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

## Contribution Guidelines

- Keep draft data local to the browser.
- Do not add analytics, remote APIs, backend calls, or AI services.
- Avoid broad permission changes unless they are clearly required.
- Add UI changes in the existing React and Tailwind style.
- Keep sensitive field protection conservative.
- Prefer focused pull requests with a clear explanation.

## Testing Extension Changes

1. Run `pnpm build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Load `.output/chrome-mv3` as an unpacked extension.
5. Test autosave and restore on a page with supported text fields.

Do not include real private draft text in screenshots, logs, issues, or pull requests.
