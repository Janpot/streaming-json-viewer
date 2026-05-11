# Experiment: JSON-mirroring DOM refactor

> **Status**: experimental, on branch `experiment/json-mirror-dom-refactor` only.
> **Verdict**: rendering is correct in factor=1 mode and for shallow factor>1
> chains, but a real visual regression appears in factor>1 mode with deeply
> nested chains (4+ sticky levels — exemplified by the docs `15MB` demo).
> Don't merge to `main` until the deep-nesting issue is solved.

## How to re-enter this experiment

1. **Read this file first** — full context lives here, not in conversation
   history.
2. **Run the diagnostic test** to see the regression with your own eyes:
   ```bash
   pnpm -F streaming-json-viewer test -- large-content -t "docs 15MB demo mirror"
   ```
   Then compare the generated screenshot against
   [`experiments/demo-mirror-OLD-correct.png`](experiments/demo-mirror-OLD-correct.png)
   and [`experiments/demo-mirror-NEW-broken.png`](experiments/demo-mirror-NEW-broken.png).
3. **Or open the docs `15MB` demo locally** (`pnpm -F docs dev`) and scroll all
   the way down — the bug is reproducible there too.

## Goal

Replace the current "flat virtualized list + chain-only sticky overlays" design
with a **hierarchical DOM that mirrors the JSON tree**: every container becomes
a wrapper element containing its sticky open, its visible interior children,
and an absolute close at the bottom.

User question that prompted the exploration:

> Can't we just have a natural hierarchy where lines are children of groups?

## Original split design (what's on `main`)

The pre-experiment code split rendering into two concerns:

- **Flat virtualized row list** under a single `spacer` div. Every visible
  row computes `top: idx*RH + translateY` in spacer coords. One stable parent,
  no DOM re-parenting on scroll.
- **One-path sticky overlay scaffold** (`wrapperChain`): walks root → deepest
  container whose body covers the viewport. Renders that chain (and only that
  chain) as nested `position:absolute` divs each hosting a `position:sticky`
  open row. Other containers' opens are flat rows.

The chain wrappers use **delta-compensated coords** so that, in factor>1 mode,
their compressed positions still produce CSS-sticky pin/pushup transitions at
the correct doc-coord moments:

```ts
const delta = (factor - 1) / factor;
const wrapperTopAbs = (lineIdx, depth) =>
  (lineIdx * RH) / factor + depth * RH * delta;
const wrapperHeight =
  ((subtreeLines - 1) * RH) / factor + RH * delta;
```

Why this design *works for everything*:

- **Compressed wrappers fit the spacer.** The spacer is capped at
  `SAFE_MAX_SPACER_HEIGHT = 8M px` (under Firefox's ~17M element-coord limit).
  Chain wrappers' top + height land within the spacer regardless of doc size.
- **Only the chain has stickies.** At each depth, only one wrapper exists —
  the unique ancestor whose body covers the viewport at that depth. No
  competing siblings at the same depth.
- **Flat rows are unaffected by chain identity.** Their position is purely a
  function of their line index. As you scroll across sibling subtrees, the
  chain identity changes but flat rows just translate uniformly.

## Refactored design (what's on this branch)

A single recursive `renderNode` replaces the wrapperChain walk + flat row
collection + dual render paths:

```
spacer
└─ root wrapper (depth 0)
   ├─ sticky open
   ├─ interior rows (primitives, dynamic top)
   ├─ nested wrapper (depth 1)
   │  ├─ sticky open
   │  └─ ...
   └─ close (absolute, top: wrapperHeight)
```

Key implementation pieces (`packages/streaming-json-viewer/src/JsonViewer.tsx`):

- `pinnedChainIds` / `pinnedSet` / `deepestPinnedId` — kept the chain walk
  (purely for `data-sticky` / `data-sticky-last` attributes; doesn't drive
  rendering anymore).
- `wrapperTopAbsFn(lineIdx, depth)` and `wrapperHeightFn(subtree)` — same
  delta-compensated math as before, but now applied to **every** rendered
  container (not just chain entries).
- `renderNode(id, lineIdx, depth, parentTopAbs, isOutermost)` — recursive
  visitor:
  - early-out if subtree fully outside `[startIdx, endIdx]`
  - transparent containers pass through children with the same context
  - expanded containers render as a wrapper with sticky open + recursed
    children + absolute close
  - leaves (primitives, collapsed/empty containers) render as a single row
- **Interior rows use dynamic `top`**: `K*RH + translateY - parentTopAbs`. In
  factor=1 mode this collapses to the static `(K - parentLineIdx) * RH`. In
  factor>1 mode it tracks the row's true doc-coord viewport y as you scroll.

Diff stats vs `main`:

```
packages/streaming-json-viewer/src/JsonViewer.tsx | 410 +++++++++++-----------
1 file changed, 200 insertions(+), 210 deletions(-)
```

Net: roughly the same line count. The wins were intended to be:

1. ✓ Hierarchical wrappers mirror the JSON tree.
2. ✓ `Group` props apply to **every** visible container's wrapper (not just
   the chain). More uniform / discoverable.
3. ✓ The wrapper-open / flat-row duality goes away — a node's open is always
   inside its wrapper, never re-parented.

## What was prototyped before implementing

Two CSS questions were verified in standalone HTML files. **The prototypes
are committed in [`experiments/`](experiments/)** — open them in a browser
(`open packages/streaming-json-viewer/experiments/prototype-*.html`) to
re-run the visual checks. The geometry math from each is summarized below.

### Prototype 1: close-row overflow trick

File: [`experiments/prototype-1-close-row-overflow.html`](experiments/prototype-1-close-row-overflow.html)

**Question**: in factor=1 mode, can the close row sit at `top: wrapperHeight`
inside the wrapper (= the wrapper's bottom edge), painting via default
`overflow: visible`, while sticky push-up still fires at the correct moment?

**Result**: ✓ Works. The close paints just below the wrapper bottom, and
because the wrapper height ends at the close's *top* (not *bottom*), the
close's arrival at the depth slot is what pushes the sticky up — exactly the
same timing as the production `wrapperHeight = (subtree - 1) * RH` formula.

### Prototype 2: pixel-cap dynamic-wrapper math

File: [`experiments/prototype-2-pixelcap-dynamic-wrapper.html`](experiments/prototype-2-pixelcap-dynamic-wrapper.html)

**Question**: in factor>1 mode, how to position wrappers so their interior
rows can have static `top`?

**Initial answer (what the prototype demonstrates, INCORRECT at scale)**:
position the **outermost** wrapper at `lineIdx*RH + translateY` (uncompressed;
the wrapper translates with the spacer's scroll via a CSS variable `--ty`),
with `wrapperHeight = (subtree-1)*RH` (uncompressed). Interior rows then get
static `(K - parentLineIdx) * RH`. The prototype uses synthetic `factor=2` on
50 lines so the values stay tiny and Chrome lays it out cleanly — that's why
it looks like a clean simplification of the production math.

**Why it fails on real data**: in factor>1 mode at scale, the outermost
wrapper's `translateY` becomes hugely negative (e.g. −36M px for the 15MB
demo) and the wrapper's uncompressed height exceeds Chromium's ~33M coord
limit. The wrapper fails to lay out and nothing renders. The prototype hides
this because its scale is too small to hit browser limits. Caught by the
`single-container fixture renders the last item` test on this branch (the
test bumps subtree size up to where the uncompressed wrapper height exceeds
~33M).

**Final answer (what's in the branch's code)**: revert wrappers to
**delta-compensated** positions (so they always fit in the spacer), and make
interior rows use **dynamic** `top` (`K*RH + translateY - parentTopAbs`). The
prototype's clean "no delta" math was a red herring — it only works at
prototype scale, not at real-document scale.

## What works

1. **factor=1 mode** — passes all original tests (keyboard, focus, sticky
   chain, accessibility, screenshots).
2. **factor>1 simple JSONL** (`makeHugeJsonlFixture`) — passes. Each top-level
   entry is a tiny outermost wrapper; no deep nesting.
3. **factor>1 single big container** (`makeSingleHugeArrayFixture`,
   `makeHugeArrayOfObjectsFixture`) — passes assertions and screenshot. Three
   sticky levels max (root → array → item).

## What's broken

**Visual regression in factor>1 mode with chains of 4+ sticky levels.**

Repro fixture: `makeDemoMirrorFixture(100_000)` — mirrors the docs `15MB`
demo's structure. Five sticky-chain levels: root `{` → `"items": [` →
item `{` → `"meta": {` → `"flags": {`.

Compare:

- **Correct (`main`)**: [`experiments/demo-mirror-OLD-correct.png`](experiments/demo-mirror-OLD-correct.png)
  — clean chain at top (root, items, item, meta, flags), then
  `"price"`, `"tags": [`, content rows, all properly tiled at 22px each.
- **Broken (this branch)**: [`experiments/demo-mirror-NEW-broken.png`](experiments/demo-mirror-NEW-broken.png)
  — sticky opens for `tags`, `meta`, `flags` layer/overlap on top of each
  other and on top of primitives like `"price"`, `"ready"`. Content rows for
  `meta` and `flags` appear in mostly the right places but the chain stickies
  at depths 3 and 4 are clearly wrong.

The committed test screenshot baseline
(`tests/__screenshots__/large-content.browser.test.tsx/demo-mirror-scroll-bottom-chromium-darwin.png`)
is **the broken render** — kept that way intentionally so the screenshot
test passes on this branch (otherwise CI is permanently red). When merging
or re-baselining for `main`, restore from `experiments/demo-mirror-OLD-correct.png`.

### Why it breaks (working hypothesis — not fully verified)

The OLD design renders **one wrapper per depth**: only the chain ancestors.
The NEW design renders **every container** in the visible window as its own
wrapper, each with its own `position:sticky` open.

For deep nesting, the visible window often contains:

- The chain itself (e.g. 5 nested wrappers along the deepest path).
- **Sibling wrappers at the same depths** as chain members — e.g. the
  `tags` wrapper at depth 3 *and* the `meta` wrapper at depth 3, both inside
  the same item wrapper, both rendered, each with its own depth-3 sticky
  open.

In factor>1 mode each wrapper's compressed natural position differs from
its true doc-coord position by a depth-dependent offset. CSS sticky uses the
compressed natural to decide pinning. The interaction between (a) compressed
natural positions of multiple sibling wrappers at the same depth, (b) CSS
sticky's pin-at-`depth*RH` rule, and (c) the wrappers' compressed bounds
producing same-slot competition, is what we believe causes the layering.

In factor=1 mode the same structure works fine because compressed = uncompressed,
so each sibling wrapper is at its true doc position and CSS sticky pins them
in turn naturally as you scroll across them.

The simpler `makeHugeArrayOfObjectsFixture` doesn't expose this because items
are 3-line containers — within an item there are only primitives, no nested
containers, so no depth-3 sibling wrappers can compete.

### What we don't know yet

- Exact CSS layout the browser ends up applying to overlapping nested wrappers
  in factor>1. (Would need DevTools / `getBoundingClientRect` in a live
  browser.)
- Whether the issue is purely CSS sticky-vs-compressed-coords, or also
  involves z-index stacking between siblings.
- Whether disabling sticky on **non-pinned** wrappers (treating them like
  absolute opens with a dynamic `top`) would fix it without losing the chain
  pin behavior.

## Possible paths forward

Roughly in order of effort:

1. **Hybrid mode**: keep the new recursive render in factor=1 mode, fall back
   to the OLD wrapperChain + flat rows in factor>1 mode. Fully working but
   gives up the unification benefit and reintroduces the dual structure.
2. **Suppress sticky on non-chain wrappers**: in `renderNode`, set
   `position: 'absolute'` instead of `'sticky'` on opens where
   `!pinnedSet.has(id)`, with a dynamic `top` matching their true doc-coord
   position. Pinned chain opens stay sticky. Untested. Concern: hover/focus
   transitions across the chain boundary may flicker.
3. **Render only chain wrappers, render other container opens as flat rows**:
   essentially a re-derivation of the OLD design but with the recursive
   render shape kept for the chain. Same caveat as (1).
4. **CSS `subgrid` or container queries** to align nested sticky pinning —
   speculative; would require a different structural approach entirely.

If we revisit this experiment, **option 2 is probably the best first thing
to try** — minimal change, narrowly targets the failing case, and would
preserve all the unified-DOM benefits if it works.

## Files touched on this branch

```
packages/streaming-json-viewer/
├── src/JsonViewer.tsx                  # the refactor
├── EXPERIMENT_NOTES.md                 # this file
├── experiments/
│   ├── original-plan.md                # design memo written before implementing
│   ├── prototype-1-close-row-overflow.html        # open in browser to re-verify
│   ├── prototype-2-pixelcap-dynamic-wrapper.html  # ditto (note: at prototype scale only)
│   ├── demo-mirror-OLD-correct.png     # main's render of the demo-mirror
│   └── demo-mirror-NEW-broken.png      # this branch's render
└── tests/
    ├── helpers/fixtures.ts             # added makeHugeArrayOfObjectsFixture, makeDemoMirrorFixture
    ├── large-content.browser.test.tsx  # added 3 tests for the new fixtures
    └── __screenshots__/
        └── large-content.browser.test.tsx/
            ├── demo-mirror-scroll-bottom-chromium-darwin.png         # CURRENT: broken render baseline (this branch)
            └── single-container-scroll-bottom-chromium-darwin.png    # both branches render identically
```

The `original-plan.md` in `experiments/` is the design memo I wrote before
starting implementation — it captures the initial intent and the
trade-offs I anticipated (some of which turned out to be wrong, notably the
"pixel-cap math gets simpler" claim that prototype 2 misled me into
making). Useful for understanding what hypotheses were in play; don't take
its conclusions as final — they're superseded by this file.

## Tests added (worth keeping in any case)

These exist on `main` already (committed during the experiment):

- `large-content.browser.test.tsx > single-container fixture renders the last item when wheeled to the bottom`
  — assertion test using `userEvent.wheel` and ARIA selectors. Catches the
  "outermost wrapper exceeds browser coord limits" bug from the very first
  iteration of the refactor (where wrappers used uncompressed positions).
  Verified to fail when wrappers are uncompressed.
- `large-content.browser.test.tsx > screenshot — single-container fixture wheeled to the bottom`
  — visual regression test for the simpler 3-level-chain fixture.
- `large-content.browser.test.tsx > screenshot — docs 15MB demo mirror wheeled to the bottom`
  — the diagnostic for this experiment. Baseline on `main` is correct;
  baseline on this branch is the broken render.

## Open question for review at re-entry

Is the regression actually a problem in practice? In factor>1 mode the user
is scrolling through millions of lines — they probably won't pause at the
exact bottom of a 5-level-deep chain often. But the docs `15MB` demo *does*
exhibit it and looks visibly broken there. So: yes, it's a problem.
