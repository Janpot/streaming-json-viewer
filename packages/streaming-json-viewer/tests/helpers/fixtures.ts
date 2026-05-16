/**
 * All fixtures return strings. The library streams strings via chunked
 * `tokenizer.feed`, so even synchronous fixtures pass through `streaming` →
 * `done`.
 *
 * Row-count notes (used by tests):
 * - "open" rows are `treeitem`s; "close" rows are aria-hidden.
 * - The library wraps everything in a transparent root array — its open/close
 *   are not rendered, so `totalLines` only counts user-visible rows.
 */

export function makeTinyFixture(): string {
  return JSON.stringify({
    name: 'Ada',
    active: true,
    score: 42,
    nick: null,
    nested: { a: 1, b: 2 },
  });
}

/** ~25 visible rows. Two top-level keys, one a nested array of objects. */
export function makeSmallFixture(): string {
  return JSON.stringify({
    title: 'small fixture',
    items: [
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
      { id: 3, label: 'three' },
    ],
  });
}

/**
 * Predictable medium fixture used for ARIA, keyboard, and sticky tests.
 *
 * Shape:
 *   {                                  // open (depth 0)
 *     title: "...",                    // depth 1
 *     users: [                         // open (depth 1)
 *       {                              // open (depth 2)
 *         id, name, address: { ... }, tags: [ ... ]
 *       },
 *       ...5 users
 *     ]
 *   }
 */
export function makeMediumFixture(): string {
  const users = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    name: `user-${i + 1}`,
    address: {
      city: `city-${i + 1}`,
      zip: `0000${i + 1}`,
    },
    tags: [`tag-${i + 1}-a`, `tag-${i + 1}-b`],
  }));
  return JSON.stringify({ title: 'medium fixture', users });
}

/** Deep nested-object fixture for stacked-sticky screenshots. */
export function makeDeeplyNestedFixture(depth = 6): string {
  let obj: Record<string, unknown> = { leaf: 'bottom' };
  for (let i = depth - 1; i >= 0; i--) {
    obj = { [`level_${i}`]: obj, [`marker_${i}`]: i };
  }
  return JSON.stringify(obj);
}

/**
 * Root object with a big `head` array at depth 1, followed by enough trailing
 * scalar keys that `head`'s close row can be scrolled all the way up to its
 * depth slot. Used to assert the sticky-header push-up geometry.
 *
 * Line layout (root object rendered at depth 0):
 *   0: `{`            1: `"head": [`   2..(arrayCount+1): numbers
 *   arrayCount+2: `]` (head close, depth 1)
 *   then `trailing` scalar keys, then root `}`.
 * With the defaults: head open=1, head close=42.
 */
export function makePushUpFixture(arrayCount = 40, trailing = 20): string {
  const obj: Record<string, unknown> = {
    head: Array.from({ length: arrayCount }, (_, i) => i),
  };
  for (let i = 0; i < trailing; i++) obj[`t${i}`] = i;
  return JSON.stringify(obj);
}

/**
 * JSONL fixture: `count` separate top-level objects, one per line. The lib
 * accepts JSONL (multiValue parser) and folds the lines into a transparent
 * root array, so each line is one visible row at depth 0.
 *
 * Default `count` = 500_000 → totalLines = 500_000 → fullHeight ≈ 11M px,
 * which exceeds SAFE_MAX_SPACER_HEIGHT (8M) and triggers factor > 1 mode.
 */
export function makeHugeJsonlFixture(count = 500_000): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    parts.push(`{"i":${i}}`);
  }
  return parts.join('\n');
}

/**
 * Single huge array — the array's own subtree (open + N children + close)
 * exceeds SAFE_MAX_SPACER_HEIGHT, validating that the factor mechanism
 * handles a single subtree taller than the spacer cap.
 */
export function makeSingleHugeArrayFixture(count = 500_000): string {
  const parts = new Array<string>(count);
  for (let i = 0; i < count; i++) parts[i] = String(i);
  return `[${parts.join(',')}]`;
}

/**
 * Root object whose `"items"` property is a huge array of small object
 * entries — three lines per entry (open / one key / close) gives a total line
 * count whose uncompressed height (`totalLines × ROW_HEIGHT`) exceeds the
 * browser's element-coord limit (~33M px in Chromium). Nesting the array
 * inside a parent object exercises the multi-level sticky chain (root `{` at
 * depth 0, `"items": [` at depth 1, each item at depth 2).
 */
export function makeHugeArrayOfObjectsFixture(count = 600_000): string {
  const parts = new Array<string>(count);
  for (let i = 0; i < count; i++) parts[i] = `{"i":${i}}`;
  return `{"items":[${parts.join(',')}]}`;
}

/**
 * Mirror of the docs `15MB` demo (`docs/app/demo-app.tsx` `generateDemoJson`).
 * Each item is ~20 lines (id / sku / name / active / price / tags array of 2 /
 * meta object with createdAt / notes / score / flags object), nested inside
 * a root object alongside `generatedAt`, `count`, and `schema` siblings. Used
 * for visual screenshots of factor>1 rendering on the same shape users hit
 * in the demo.
 */
export function makeDemoMirrorFixture(count: number): string {
  const TAGS = ['urgent', 'review', 'draft', 'blocked', 'ready', 'shipped', 'archived'];
  const items: unknown[] = new Array(count);
  for (let i = 0; i < count; i++) {
    items[i] = {
      id: i,
      sku: `SKU-${(i * 9301 + 49297) % 233280}`,
      name: `Item ${i}`,
      active: i % 7 !== 0,
      price: Math.round(((i * 31) % 9999999) / 100) / 100,
      tags: [TAGS[i % TAGS.length], TAGS[(i * 3) % TAGS.length]],
      meta: {
        createdAt: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString(),
        notes: i % 5 === 0 ? null : `Annotation for item ${i}, used for downstream analysis.`,
        score: i % 11 === 0 ? null : (i * 0.137) % 1,
        flags: { synced: i % 3 === 0, dirty: i % 13 === 0 },
      },
    };
  }
  return JSON.stringify({
    generatedAt: '2026-05-09T00:00:00.000Z',
    count,
    schema: {
      version: '1.4.0',
      fields: ['id', 'sku', 'name', 'active', 'price', 'tags', 'meta'],
    },
    items,
  });
}
