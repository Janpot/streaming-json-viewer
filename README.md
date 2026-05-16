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

`pnpm test` runs vitest browser tests against Chromium. On Linux it uses the locally installed browser. On macOS / Windows it transparently launches a pinned Playwright Docker image (`mcr.microsoft.com/playwright:v<installed-version>-noble`) and connects to a remote `playwright run-server` inside it, so screenshot baselines render under the same Linux Chromium that CI uses.

Requirements on non-Linux hosts: Docker Desktop running. The first invocation pulls a ~2 GB image; subsequent runs spin up a container in a few seconds.

- `pnpm test` — run once.
- `pnpm -F streaming-json-viewer test:watch` — watch mode (container stays up between reruns).
- `pnpm -F streaming-json-viewer test:update-screenshots` — regenerate baselines after intentional visual changes.

## TODO

- search
