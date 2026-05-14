import { createTreeBuilder } from './tree';
import type { TreeNode } from './types';

/**
 * A parsed JSON tree, ready to render via `<JsonViewer.Root value={...}>`.
 *
 * Library-produced instances of this class are the unambiguous "pre-built
 * tree" handoff — `<Root>` checks `value instanceof ParsedJson` to decide
 * whether to treat the prop as a tree or to convert a raw JS value via
 * `ParsedJson.from`. Mirrors the fetch/URL/Request pattern.
 */
export class ParsedJson {
  readonly nodes: TreeNode[];

  constructor(nodes: TreeNode[]) {
    this.nodes = nodes;
  }

  /**
   * Walk an already-parsed JS value into a `ParsedJson`. Synchronous,
   * complete, no yielding. For a complete JSON string, run `JSON.parse`
   * first. For inputs that should yield to the main thread, use
   * `useStreamingNodes` from the streaming entry.
   *
   * Top-level `undefined` produces an empty tree — the "no data" sentinel.
   * Top-level `null` is a valid JSON value and renders as one `null` row.
   */
  static from(value: unknown): ParsedJson {
    const builder = createTreeBuilder();
    if (value !== undefined) {
      walk(value, null, builder.handlers);
    }
    return new ParsedJson(builder.nodes);
  }
}

type Handlers = ReturnType<typeof createTreeBuilder>['handlers'];

function walk(value: unknown, key: string | number | null, h: Handlers): void {
  if (value === null) {
    h.value(key, null);
    return;
  }
  if (Array.isArray(value)) {
    h.openArray(key);
    for (let i = 0; i < value.length; i++) walk(value[i], i, h);
    h.closeArray();
    return;
  }
  const t = typeof value;
  if (t === 'object') {
    h.openObject(key);
    for (const k of Object.keys(value as object)) {
      walk((value as Record<string, unknown>)[k], k, h);
    }
    h.closeObject();
    return;
  }
  if (t === 'string' || t === 'number' || t === 'boolean') {
    h.value(key, value as string | number | boolean);
    return;
  }
  // undefined / function / symbol / bigint — treat as null.
  h.value(key, null);
}
