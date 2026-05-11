# Sketch: JSON-mirroring DOM hierarchy in JsonViewer

## Context

The current `JsonViewer.Viewport` (`packages/streaming-json-viewer/src/JsonViewer.tsx`)
renders a **flat virtualized row list** under a single `spacer` div, plus a
separate **one-path "wrapperChain"** of nested `position:absolute` divs that
host the `position:sticky` open rows for the chain root → deepest covering
ancestor.

The user's question: can we instead have a DOM that mirrors the JSON tree —
i.e. each container becomes a wrapper div, its rows are children of that
wrapper, recursively?

This document sketches what that refactor would look like, identifies the
load-bearing constraints, and lays out the trade-offs. **No commitment to
implement** — this is a design exploration.

## Why explore this

The current design splits the world in two: a flat row list **and** a sticky
overlay scaffold. A JSON-mirroring shape would unify them — `Group` props
genuinely apply to every group, the DOM shape matches the user's mental
model, and the `wrapperChain` walking code (`JsonViewer.tsx:511-550`) goes
away. Whether that simplification is worth the new complexity (below) is
the question this plan helps answer.

## Proposed DOM shape

```html
<viewport role="tree" style="overflow:auto; contain:strict">
  <spacer style="height:spacerHeight; position:relative">
    <!-- root group -->
    <div data-group="0" style="position:absolute; top:0;
                               height:(rootSubtreeLines-1)*RH">
      <!-- open: sticky inside its group -->
      <div data-row="open" style="position:sticky; top:0*RH; height:RH">{</div>

      <!-- a container child: nested group div -->
      <div data-group="1" style="position:absolute;
                                 top:1*RH;            <!-- relative to root group -->
                                 height:(subtreeLines-1)*RH">
        <div data-row="open" style="position:sticky; top:1*RH; height:RH">"users": [</div>

        <!-- primitive children of users -->
        <div data-row style="position:absolute; top:1*RH;       height:RH">…</div>
        <div data-row style="position:absolute; top:2*RH;       height:RH">…</div>
        <!-- close of users: positioned at the wrapper's bottom edge,
             rendered via overflow:visible so it paints correctly -->
        <div data-row="close" style="position:absolute;
                                     top:(usersSubtreeLines-1)*RH;
                                     height:RH">]</div>
      </div>

      <!-- close of root -->
      <div data-row="close" style="position:absolute;
                                   top:(rootSubtreeLines-1)*RH;
                                   height:RH">}</div>
    </div>
  </spacer>
</viewport>
```

**Key trick — the "wrapper height = subtreeLines − 1" invariant.**
Each group's height ends at its own close row's *top*. The close row itself
is positioned at `top: (subtreeLines − 1) * RH`, which is exactly the
wrapper's bottom edge — and is rendered via `overflow: visible` (the
default) so it paints just below. This preserves the current sticky
push-up math in a hierarchical shape: the sticky open's containing block
ends at the close's top, so CSS push-up fires at the right moment.

(The current code already computes `wrapperHeight = (subtreeLines − 1) * RH`
at `JsonViewer.tsx:687`. The new design generalizes that rule to every
group, and embeds the close as the last absolutely-positioned child.)

## Rendering algorithm

Replace the flat `visibleLines` loop and the `wrapperChain` walk with a
**recursive render** rooted at node 0:

```ts
function renderGroup(node, openLineIdx, depth, parentTopAbs):
  if subtree fully outside [startIdx, endIdx]:
    return null

  const groupTopAbs = openLineIdx * RH
  const groupHeight = (subtreeLines - 1) * RH

  return (
    <div data-group={id}
         style={{ position:'absolute',
                  top: groupTopAbs - parentTopAbs,
                  height: groupHeight }}
         {...groupProps}>
      <Row kind="open" position="sticky" top={depth*RH} />

      {childIds.map(childId => {
        const child = nodes[childId]
        const childOpenIdx = ...accumulated
        if (child is container) {
          return renderGroup(child, childOpenIdx, depth+1, groupTopAbs)
        } else {
          if (childOpenIdx outside [startIdx, endIdx]) return null
          return <Row kind="primitive" position="absolute"
                      top={(childOpenIdx - openLineIdx) * RH} />
        }
      })}

      <Row kind="close" position="absolute"
           top={(subtreeLines-1)*RH} />
    </div>
  )
```

**Virtualization**: each recursive call early-returns if the subtree is
outside `[startIdx − OVERSCAN, endIdx + OVERSCAN]`. Containers that are
partially visible recurse into their children with the same window.

**Transparent root** (`ContainerNode.transparent`, `types.ts:19`): keep the
current behavior — skip the wrapper, render children at parent depth.

## Critical files to modify

- `packages/streaming-json-viewer/src/JsonViewer.tsx` — `Viewport` body
  (lines 503-790). Delete `wrapperChain` construction (511-550),
  `visibleLines` flat collection (561-573), `renderWrapper` (669-736),
  `renderAbsRow` (643-660). Replace with single recursive `renderGroup`.
- `packages/streaming-json-viewer/src/Line.tsx` — `LineContextValue` and
  `Line` mostly unchanged; `position` still flips between `'sticky'` and
  `'absolute'` based on row kind.
- `packages/streaming-json-viewer/src/tree.ts` — may need a helper to
  compute a child's `openLineIdx` cheaply (currently
  `getNodeLineIdx` walks; for batch use during recursive render, an
  accumulator pattern is fine).

## What stays the same

- `Store`, `tree`, `parser`, `tokenizer`, `ingest` — untouched.
- Public API (`Root`, `Body`, `Group`, `Line`, `Trigger`, `LineContent`) —
  signatures unchanged. Only the *meaning* of `Group` shifts: its props
  now apply to **every** rendered group, not just chain wrappers. This is
  arguably more intuitive but is a behavioral change for any consumer
  styling group divs differently from rows.
- Pixel-cap fallback (`factor > 1`): the same `delta` compensation
  (`JsonViewer.tsx:665-687`) carries over per-group. Sticky still works
  because the math compensates per containing block.
- Roving tabindex, focus-restore effect, keyboard nav, `ensureLineVisible`
  — logic unchanged.

## Trade-offs vs. current design

**Wins**
- One DOM model instead of two (flat list + chain). Less to explain.
- `Group` props apply uniformly — matches user mental model.
- Removes ~80 lines: `wrapperChain` walk, the `flatRows` filter, the
  dual render paths (`renderWrapper` + `renderAbsRow`).
- The "wrapper-open vs. flat-row duality" disappears, so the focus-restore
  effect at `JsonViewer.tsx:757-784` only needs to handle virtualization
  eviction (one cause, not two).

**Costs**
- **Recursive render with virtualization windowing.** Has to early-out at
  every subtree boundary; bug-prone (off-by-one on subtree ranges,
  transparent-root edge case).
- **Coordinate cascade.** Each group's children compute `top` relative to
  the group, not the spacer. Recursive render needs to thread
  `parentTopAbs`. Current code has one coord system; the new code has N.
- **More DOM nodes when deeply nested.** Today, viewing a row 10 levels
  deep adds ≤10 wrapper divs (chain). In the new design, *every* visible
  ancestor renders as a group div — same upper bound but the count is
  always exactly `depth`, not "deepest covering" only. In practice this
  is usually the same number, but for siblings at the same depth it
  multiplies (e.g., 50 visible array items each get their own group div
  if they're containers).
- **Sticky stacking with siblings.** When two sibling containers are
  partially visible at once (e.g., end of `a`'s subtree and start of
  `b`'s), both groups have sticky opens at the same `top`. CSS handles
  this — their scroll ranges are disjoint — but the visual at the
  boundary needs verification (a moment where neither is pinned, or a
  flicker as one unpins and the next pins).
- **Child layout cost.** Today, only `flatRows` (≤ window size) plus
  `wrapperChain.length` (≤ depth) divs are rendered. In the new design,
  every visible container recurses; for an array of 1000 primitive
  children with 30 visible, that's still 30 row divs — but the array's
  group div is rendered. For 1000 visible *container* children, all 1000
  group divs render. Existing flat-list approach already pays this
  through `renderAbsRow` for each visible row, but the new design
  multiplies by the number of visible containers — so the cost is
  similar in the common case, slightly higher when many containers are
  partially visible at once.

## Open questions to resolve before implementing

1. **Close-row painting.** Confirm `overflow: visible` on the wrapper +
   close at `top: (subtreeLines − 1) * RH` paints correctly across
   browsers, and doesn't break sticky behavior. Easy to prototype in
   isolation.
2. **Click-to-collapse on a sticky header.** `handleStickyToggle`
   (`JsonViewer.tsx:328-343`) currently uses the `wrapperChain` index as
   `slot`. New equivalent: at the moment of click, walk parents to count
   how many sticky-pinned ancestors precede this row. Doable but new
   bookkeeping.
3. **`lastPinnedLevel` / `data-sticky-last`** (line 555-559). Today this
   is a single bottom-of-chain marker. In the new design it's "deepest
   currently-pinned group anywhere in the visible region." Computable but
   needs a pass after layout — or by tracking which groups are currently
   in their pinned range.
4. **Pixel-cap mode in deeply-nested trees.** Per-group `delta`
   compensation needs verification — the current code only applies it to
   one chain. Does cascading `delta` through multiple levels of group
   divs still land sticky transitions correctly? Worth a proof-of-concept
   before committing.
5. **Group props applied to all groups vs. only chain wrappers** — is
   anyone depending on the current behavior? Check the test snapshots and
   the README docs.

## Verification

If this is implemented:

1. Run `pnpm -F streaming-json-viewer test` — the existing keyboard,
   focus, and scroll tests in `mouse-and-keyboard.browser.test.tsx`
   should pass unchanged.
2. Manually verify in the demo (`apps/web` or whatever the playground
   is): scroll deep nests, click sticky headers to collapse, scroll past
   sibling boundaries, test pixel-cap mode with a 100k-line JSON.
3. Confirm DOM diff matches expectation with a small fixture: e.g. a
   `{ "a": [{...}, {...}] }` snapshot showing the nested group
   structure.
4. Re-run any `data-sticky-last` consumer styling — the visual chain
   shadow / divider should still appear under the deepest pinned header.

## Accessibility considerations

The current code uses the **flat tree** ARIA pattern: `role="tree"`
containing flat `role="treeitem"`s with `aria-level` /
`aria-setsize` / `aria-posinset` (`Line.tsx:248-259`). Close rows are
`aria-hidden`. This is a fully valid WAI-ARIA tree pattern and is what
most virtualized tree views in production use.

The alternative is **nested treeitems with `role="group"`**, which
WAI-ARIA Authoring Practices calls the preferred approach. Switching
to that would require:

- Moving `role="treeitem"` from the open row to the wrapper div
- Adding `role="group"` to a sub-div around the children
- Restructuring `<Line>` so it wraps children rather than being a leaf
  (significant API change)

**A JSON-mirroring DOM hierarchy does NOT automatically give you the
nested ARIA pattern** — they're independent decisions. The
combinations:

- DOM hierarchy + flat AT (`aria-level`): same accessibility as today.
- DOM hierarchy + nested AT (`role="group"`): modestly more
  "ARIA-natural" but a bigger API change; both patterns are widely
  supported; flat AT is the convention for virtualized trees.

**Conclusion**: accessibility is not a driver for this refactor. If
done for simplification reasons, sticking with flat AT (current
behavior) is the safe choice.

## Prototype findings (2026-05-09)

Both load-bearing questions verified in standalone HTML prototypes
(saved at `/tmp/sticky-pushup-prototype.html` and
`/tmp/sticky-pixelcap-prototype.html`).

### Open question 1: close-row overflow trick — works ✓

A close row positioned absolutely at `top: (subtree − 1) × RH` inside
its wrapper paints below the wrapper bottom via default
`overflow: visible`, and CSS sticky push-up fires at the correct moment.
Sticky and close move in lockstep with a one-row offset throughout
push-up, identical to current production behavior.

### Open question 4: pixel-cap math — simpler, not more complex ✓

**Original concern**: nested delta compensation (current
`wrapperTopAbs = lineIdx*RH/factor + depth*RH*delta`) might not compose
cleanly when wrappers are part of a JSON-mirroring tree.

**What actually works**: drop delta compensation entirely. Use
*dynamic* wrapper positioning instead.

The current code uses *static* delta-compensated positions because
wrappers are only added to the chain when active — the discontinuity
between "pre-activation true-line position" and "delta-compensated
position" is never exposed because the wrapper isn't rendered before
activation. In a JSON-mirroring tree, every container is always a
wrapper, so the discontinuity becomes visible (open row "floats" at
the wrong y before sticky activates — verified in v1 of the prototype).

The fix:

- **Root wrapper top**: `calc(rootLineIdx * RH + var(--ty))` —
  follows scroll via CSS variable
- **Nested wrapper top**: `(lineIdx − parentLineIdx) * RH` — static
  relative to parent, parent already translates
- **Wrapper height**: `(subtree − 1) × RH` — uncompressed, static
- **Interior rows**: `top: (K − parentLineIdx) × RH` — static
- **Close row**: `top: wrapperHeight` — static
- **`--ty`**: set on the spacer once per scroll
  (`spacer.style.setProperty('--ty', `${translateY}px`)`)

The pin/push-up math derived from this:
- Pin start: `scrollTop > (K − depth) × RH / factor` — matches
  factor=1 doc moment ✓
- Push-up start: `scrollTop > (K + subtree − depth − 2) × RH / factor`
  — matches factor=1 doc moment ✓

**No delta term anywhere.** This deletes ~25 lines of the most subtle
math in the file (`JsonViewer.tsx:663-687`).

### Updated cost/benefit

The "coordinate cascade" cost listed earlier is wrong. There IS no
cascade — interior rows have static `top` relative to wrapper, wrapper
positions are either dynamic (root, via `--ty`) or static (nested,
relative to parent). The translation is single-source-of-truth on the
spacer.

Updated wins:

- One DOM model instead of two
- `Group` props apply uniformly
- Removes `wrapperChain` walk (~40 lines)
- **Removes delta-compensation math (~25 lines)** ← new
- **Removes `localOffset` complexity from sticky path** (still needed
  for scroll math, but doesn't enter wrapper positioning) ← new
- Wrapper-open/flat-row duality disappears, simplifying focus restore

Updated costs (smaller than originally estimated):

- Recursive render with virtualization windowing
- More DOM nodes when many siblings are containers (unchanged from
  earlier estimate)
- Need to handle close-row painting via overflow:visible (verified ok)

## Recommendation (revised)

**The refactor is more attractive than the original sketch suggested.**
With both load-bearing pieces verified cheap, the remaining open
questions (#2 click-to-collapse, #3 `lastPinnedLevel`, #5 `Group` prop
behavioral change) are all small implementation details, not
architectural risks.

Proceed by writing a draft implementation in a branch, validate against
the existing test suite (`mouse-and-keyboard.browser.test.tsx`), and
benchmark scroll perf on a large fixture. If the test suite passes
with minimal changes and perf is comparable, ship it. If perf
regresses (CSS calc on every wrapper might be measurable), fall back
to setting `--ty` only when `factor > 1` — in factor=1 mode the calc
collapses to a static value anyway.
