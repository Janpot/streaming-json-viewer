# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

The library (`streaming-json-viewer`) is unpublished. Treat API changes as free — no semver / breaking-change concerns when reshaping exports, token names, prop names, etc.

## Workspace

pnpm monorepo (pnpm@9.15.0, `pnpm-workspace.yaml`):

- `packages/streaming-json-viewer` — the React library
- `docs` — Next.js demo site that consumes the workspace package

Always invoke workspace commands via `pnpm -F <name> <command>` (e.g. `pnpm -F streaming-json-viewer test`). Do not `cd` into packages.

## Commands

Root:

- `pnpm build` — build the library (`tsdown`)
- `pnpm dev` — run all `dev` scripts (the docs site)
- `pnpm lint` — `eslint .`
- `pnpm typecheck` — recursive `tsc --noEmit`
- `pnpm test` — proxies to `pnpm -F streaming-json-viewer test`
- `pnpm format` / `pnpm format:check` — prettier

Library-only (`pnpm -F streaming-json-viewer …`):

- `test` — `vitest run` (browser mode, single pass)
- `test:watch` — vitest watch mode; container stays up between reruns
- `test:update-screenshots` — `vitest run -u` after intentional visual changes
- `test:install` — `playwright install chromium` (only needed when using the host `playwright()` provider; the dockerized provider ships its own browser)

Run a single test file: `pnpm -F streaming-json-viewer test tests/<name>.browser.test.tsx`. Filter by name: `... test -t "<pattern>"`.

## Browser test setup

`pnpm test` runs Vitest browser tests against Chromium. The browser provider is wired explicitly in `vitest.config.ts` — there is no platform/env auto-detection.

- **Default (`dockerizedPlaywright()` in `vitest.config.ts`):** on every OS, launches a pinned `mcr.microsoft.com/playwright:v<version>-noble` Docker container and connects to `playwright run-server` inside it, so screenshot baselines always render under the same Linux Chromium. Docker Desktop must be running. First invocation pulls ~2 GB; subsequent runs are fast.
- **Host Chromium:** swap `browser.provider` in `vitest.config.ts` to the plain `playwright()` provider (and remove the `resolveDocker*Path` overrides). Faster local triage, but visual snapshots will diverge from the Linux baselines.

Screenshot baselines live in `packages/streaming-json-viewer/tests/__screenshots__/`.

## Architecture

The library is a pipeline from bytes to rendered rows. Each stage is in its own file under `packages/streaming-json-viewer/src/`:

```
input → tokenizer.ts → parser.ts → tree.ts (TreeBuilder) → ParsedJson → JsonViewer
```

- **tokenizer.ts** — character-by-character state machine. Emits `TokenType` tokens (`lbrace`, `string`, `number`, `comma`, etc.) via a callback. Resumable across feed boundaries.
- **parser.ts** — token-stream state machine on top of the tokenizer. Calls `ParserHandlers` (openObject, openArray, closeObject, closeArray, value). Supports `multiValue` for JSONL / concatenated JSON.
- **tree.ts** — `createTreeBuilder()` produces `ParserHandlers` that build a flat `TreeNode[]` (each node has `id`, `parentId`, `siblingIdx`, `childIds`, `subtreeLines`). Also contains the line-cursor primitives: `getLineAt`, `nextLine`, `prevLine`, `firstOpenLine`, `lastOpenLine`, `nodeSubtreeLines`, `propagateSubtreeChange`. `subtreeLines` is maintained incrementally so collapse/expand and streaming inserts are O(depth), not O(tree).
- **sync.ts (`ParsedJson`)** — public, opaque container for `nodes[]`. `ParsedJson.from(value)` walks a JS value synchronously. `<JsonViewer.Root>` checks `value instanceof ParsedJson` (fetch/URL/Request pattern) and auto-wraps raw values otherwise.
- **streaming.ts (`useStreamingNodes`)** — hook for live streaming. Wraps the input in a synthetic **transparent root** (an array with `transparent: true`) so multiple top-level JSON documents (JSONL) appear as siblings at depth 0 without rendering the array's own open/close rows. Drives renders via `useSyncExternalStore` (SyncLane) because the ingestion loop yields on the same task lane and would otherwise starve a `useState` setter.
- **ingest.ts** — reads strings or `ReadableStream`s into the tokenizer in chunks; cooperative yielding via `scheduler.yield()`.

### Render layer

- **JsonViewer.tsx** — `Root` (context provider), `Viewport` (scroll container + virtualization + sticky-chain wrapper render), `Content` / `Group` (slot markers; consumers' render-props produce row content).
- **Line.tsx** — `Line` (row wrapper, owns ARIA + positioning), `Trigger` (collapse chevron slot), `LineContent` (default tokenized row content). Each rendered token gets a `data-token="…"` attribute (`property`, `punctuation`, `bracket`, `string`, `number`, `boolean`, `null`, `ellipsis`, `count`). `punctuation` is used for both `:` after a key and `,` between siblings. Consumers style via `[data-token=…]` selectors — see `docs/demo/*/index.module.css` and `packages/streaming-json-viewer/tests/test-styles.css` for the reference styling.

### Transparent containers

A `ContainerNode` with `transparent: true` is not rendered (no open/close rows, no indent, no comma between its children). Used as the synthetic root in `useStreamingNodes` so JSONL records appear as top-level siblings. All renderers, line-cursor walkers, and depth calculations in `tree.ts` and `JsonViewer.tsx` must respect this flag.

### Virtualization & the `factor` scheme

When `virtualized={true}` and the full document height (`totalLines * ROW_HEIGHT`) exceeds `SAFE_MAX_SPACER_HEIGHT` (see `constants.ts`), the spacer is capped and the viewer enters a compressed-scrollbar mode: `factor = docRange / scrollRange > 1`. DOM `scrollTop` is derived from a doc-space `docScrollTop` state, and wrapper positions/heights are delta-compensated so CSS sticky pin/push transitions fire at the correct doc-space moments.

The render uses a **recursive wrapper-per-container** approach: every non-transparent expanded container becomes an absolutely-positioned `<div>` holding a sticky open row, its interior children, and an absolute close row. This produces the "sticky chain" of pinned ancestor headers (`data-sticky`, `data-sticky-last`).

A known issue with the `factor>1` path and deep sticky chains is captured in `EXPERIMENT_NOTES.md` (if present) and inline comments in `Viewport`. Don't try to "fix" the compressed-coord formulas without understanding that they reduce to the natural flat-row formulas when `factor === 1`.

### Focus model

Roving tabindex: exactly one row carries `tabIndex=0`. Tracking lives in `Root` (`focusedId`). `Viewport` derives `effectiveFocusedId` each render — falling back to the first pinned ancestor or `firstOpenLine` when the focused row is unmounted (virtualization eviction). DOM focus is restored in a `useLayoutEffect` driven by `shouldFocusDomRef`. Close rows are `aria-hidden` / `role=presentation` and never own the tab stop — the container's open row is the single treeitem for the node.

## Conventions

- Prettier config lives at the workspace root; format generated code accordingly.
- Don't use `try`/`catch` that only logs and re-throws — let errors bubble.
- The library's only peer deps are React ≥18, React-DOM ≥18, and `@base-ui/react` ≥1.4 (used for `useRender` slot composition). Keep new runtime deps out of the library.
