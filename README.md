# streaming-json-viewer

Streaming JSON viewer for React. Incremental parse, virtualized rendering, sticky ancestor headers.

## Workspace

- `packages/streaming-json-viewer` — the library
- `docs` — Next.js demo site

## Develop

```bash
pnpm install
pnpm build       # build the library
pnpm dev         # run the docs site
```

## Testing

`pnpm test` runs vitest browser tests against Chromium. The browser provider is wired explicitly in `vitest.config.ts` (no platform/env auto-detection): by default it launches a pinned Playwright Docker image (`mcr.microsoft.com/playwright:v<installed-version>-noble`) on every OS and connects to a remote `playwright run-server` inside it, so screenshot baselines always render under the same Linux Chromium that CI uses.

Docker Desktop must be running. The first invocation pulls a ~2 GB image; subsequent runs spin up a container in a few seconds. To use host Chromium instead (faster local triage; visual snapshots will diverge from the Linux baselines), swap `browser.provider` in `vitest.config.ts` to the plain `playwright()` provider.

- `pnpm test` — run once.
- `pnpm -F streaming-json-viewer test:watch` — watch mode (container stays up between reruns).
- `pnpm -F streaming-json-viewer test:update-screenshots` — regenerate baselines after intentional visual changes.

## TODO

- search
