<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI/UX preview workflow

For UI/UX review or fixes, read `docs/ui-preview.md`, start the local preview with `WATCHPACK_POLLING=true pnpm dev:preview`, and open `/ui-preview` in a browser. Use its screen and scenario controls to inspect the relevant production components with synthetic data; exercise the affected interactions and relevant viewport sizes before and after changes. Preview coverage is incomplete: consult the documented screen list and use another safe local fixture or existing test setup when a page or state is missing. Preview data and blocked actions do not validate authentication, persistence, or integration behavior.
