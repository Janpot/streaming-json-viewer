# Experiment: JSON-mirroring DOM refactor

> **Status**: fix landed on branch `experiment/json-mirror-dom-refactor`. All 60
> tests pass; the docs `15MB` demo renders correctly. Ready for review / merge.
> **Verdict**: hierarchical wrappers work in all modes — factor=1, factor>1
> with shallow chains, and factor>1 with deep chains (5+ sticky levels) — once
> sticky pinning is restricted to chain ancestors only (see "The fix" below).

## Goal

Replace the original "flat virtualized list + chain-only sticky overlays" design
with a **hierarchical DOM that mirrors the JSON tree**: every container becomes
a wrapper element containing its sticky open, its visible interior children,
and an absolute close at the bottom.

User question that prompted the exploration:

> Can't we just have a natural hierarchy where lines are children of groups?

## Original split design (what was on `main` before the refactor)

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
const wrapperTopAbs = (lineIdx, depth) => (lineIdx * RH) / factor + depth * RH * delta;
const wrapperHeight = ((subtree - 1) * RH) / factor + RH * delta;
```

## Refactored design (what's on this branch)

A single recursive `renderNode` replaces the wrapperChain walk + flat row
collection + dual render paths:

```
spacer
└─ root wrapper (depth 0)
   ├─ sticky-or-absolute open  (sticky only when on the chain)
   ├─ interior rows (primitives, dynamic top)
   ├─ nested wrapper (depth 1)
   │  ├─ ...
   └─ close (absolute, top: wrapperHeight)
```

Key implementation pieces (`packages/streaming-json-viewer/src/JsonViewer.tsx`):

- `pinnedChainIds` / `pinnedSet` / `deepestPinnedId` — chain walk identifies
  which wrappers are currently on the sticky chain.
- `wrapperTopAbsFn(lineIdx, depth)` and `wrapperHeightFn(subtree)` — same
  delta-compensated math as before, applied to **every** rendered container.
- `renderNode(id, lineIdx, depth, parentTopAbs, isOutermost)` — recursive
  visitor:
  - early-out if subtree fully outside `[startIdx, endIdx]`
  - transparent containers pass through children with the same context
  - expanded containers render as a wrapper with sticky-or-absolute open +
    recursed children + absolute close
  - leaves (primitives, collapsed/empty containers) render as a single row
- **Interior rows use dynamic `top`**: `K*RH + translateY - parentTopAbs`. In
  factor=1 mode this collapses to the static `(K - parentLineIdx) * RH`.

## The bug we hit (factor>1, deep chains) and the fix

When the first version of this refactor went `position: sticky` on **every**
wrapper's open, the docs `15MB` demo (5-level chain) showed multiple sticky
opens layering at the same depth slot. The root cause:

In factor>1 mode, the wrapper height formula is

```
wrapperHeight = (subtree-1)*RH/factor + RH*delta
```

The `+RH*delta` term is needed so CSS sticky's unpin moment coincides with
the close row reaching `(depth+1)*RH` in the viewport. But compare wrapper
height to the spacing between consecutive sibling wrappers:

- Spacing between siblings (compressed): `subtree * RH / factor`
- Wrapper height: `(subtree-1) * RH/factor + RH*delta`
- **Overlap = wrapperHeight − spacing = RH * (factor − 2) / factor**

So whenever `factor > 2`, every wrapper's compressed bounds overlap its next
sibling's bounds by `RH*(factor−2)/factor` px. The demo runs at factor ≈ 5.5,
i.e. ~14 px of overlap per wrapper-pair.

When the overlap region intersects a CSS sticky pin slot, **multiple** sibling
wrappers met sticky's pin condition and painted their opens on top of each
other. Deep chains exposed this dramatically because 4+ depth slots multiplied
the visible artefacts; shallow chains (≤3) didn't expose it because the only
nesting was chain ancestors (no siblings competing for the same depth).

**Fix**: only chain-pinned wrappers get `position: sticky` opens. Non-chain
wrappers' opens are `position: absolute` with
`top = lineIdx*RH + translateY − selfTopAbs` — their true doc-coord viewport
y, identical to the formula used for interior primitive rows.

Effect:

- Chain wrappers (one per depth) pin as before — no competition.
- Non-chain wrappers' opens render at their natural doc-coord position. Doc
  spacing is uncompressed, so consecutive siblings never overlap.
- Wrapper *bounds* still overlap in compressed space, but that no longer
  matters because nothing inside is sticky.

In factor=1, `delta = 0` and overlap is zero, so the change is a no-op there.

## How to verify

1. **Tests**: `pnpm -F streaming-json-viewer test`. All 60 should pass,
   including:
   - `large-content > screenshot — docs 15MB demo mirror wheeled to the bottom`
     — the canonical bug repro. Baseline now matches
     [`experiments/demo-mirror-OLD-correct.png`](experiments/demo-mirror-OLD-correct.png).
   - `large-content > single-container fixture renders the last item when
     wheeled to the bottom` — catches the original "uncompressed wrapper
     exceeds Chromium's element-coord limit" regression.
2. **Docs demo**: `pnpm -F docs dev`, open the `15MB` demo, scroll to the
   bottom. The chain stickies should stack cleanly without sibling overlap.

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
because the wrapper height ends at the close's _top_ (not _bottom_), the
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
`single-container fixture renders the last item` test (the test bumps subtree
size up to where the uncompressed wrapper height exceeds ~33M).

**Final answer (what's in the branch's code)**: revert wrappers to
**delta-compensated** positions (so they always fit in the spacer), and make
interior rows use **dynamic** `top` (`K*RH + translateY - parentTopAbs`). The
prototype's clean "no delta" math was a red herring — it only works at
prototype scale, not at real-document scale.

## Diff stats vs `main`

```
packages/streaming-json-viewer/src/JsonViewer.tsx | ~410 +++++++++++-----------
```

Net: roughly the same line count. Wins:

1. ✓ Hierarchical wrappers mirror the JSON tree.
2. ✓ `Group` props apply to **every** visible container's wrapper (not just
   the chain). More uniform / discoverable.
3. ✓ The wrapper-open / flat-row duality goes away — a node's open is always
   inside its wrapper, never re-parented.

## Files touched on this branch

```
packages/streaming-json-viewer/
├── src/JsonViewer.tsx                  # the refactor + sticky-on-chain-only fix
├── src/Line.tsx                        # (unchanged from main)
├── EXPERIMENT_NOTES.md                 # this file
├── experiments/
│   ├── original-plan.md                # design memo written before implementing
│   ├── prototype-1-close-row-overflow.html        # open in browser to re-verify
│   ├── prototype-2-pixelcap-dynamic-wrapper.html  # ditto (note: at prototype scale only)
│   ├── demo-mirror-OLD-correct.png     # main's render of the demo-mirror (= current render)
│   └── demo-mirror-NEW-broken.png      # the pre-fix render (kept for reference)
└── tests/
    ├── helpers/fixtures.ts             # added makeHugeArrayOfObjectsFixture, makeDemoMirrorFixture
    ├── large-content.browser.test.tsx  # added 3 tests for the new fixtures
    └── __screenshots__/
        └── large-content.browser.test.tsx/
            ├── demo-mirror-scroll-bottom-chromium-darwin.png         # correct render (matches OLD)
            └── single-container-scroll-bottom-chromium-darwin.png    # both branches render identically
```

The `original-plan.md` in `experiments/` is the design memo written before
implementation — it captures the initial intent and the trade-offs anticipated
(some of which turned out to be wrong, notably the "pixel-cap math gets
simpler" claim that prototype 2 misled into making). Useful for understanding
what hypotheses were in play; the findings here supersede its conclusions.

## Tests added (worth keeping in any case)

- `large-content.browser.test.tsx > single-container fixture renders the last item when wheeled to the bottom`
  — assertion test using `userEvent.wheel` and ARIA selectors. Catches the
  "outermost wrapper exceeds browser coord limits" bug from the very first
  iteration of the refactor (where wrappers used uncompressed positions).
- `large-content.browser.test.tsx > screenshot — single-container fixture wheeled to the bottom`
  — visual regression test for the simpler 3-level-chain fixture.
- `large-content.browser.test.tsx > screenshot — docs 15MB demo mirror wheeled to the bottom`
  — the canonical 5-level deep-chain regression test. Baseline is the correct
  render.
