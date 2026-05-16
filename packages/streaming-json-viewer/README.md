# streaming-json-viewer

A streaming JSON viewer for React. Incremental parse, virtualized rendering, sticky ancestor headers.

Render any value:

```tsx
import { JsonViewer } from 'streaming-json-viewer';

<JsonViewer.Root value={{ hello: 'world', items: [1, 2, 3] }}>
  <JsonViewer.Viewport style={{ flex: 1 }}>
    <JsonViewer.Content>
      {() => (
        <JsonViewer.Group className="my-group">
          {() => (
            <JsonViewer.Line className="my-line">
              <JsonViewer.Trigger>
                <MyChevron />
              </JsonViewer.Trigger>
              <JsonViewer.LineContent />
            </JsonViewer.Line>
          )}
        </JsonViewer.Group>
      )}
    </JsonViewer.Content>
  </JsonViewer.Viewport>
</JsonViewer.Root>;
```

Stream into it:

```tsx
import { JsonViewer } from 'streaming-json-viewer';
import { useStreamingNodes } from 'streaming-json-viewer/streaming';

function StreamedViewer({ source }: { source: string | ReadableStream<Uint8Array> }) {
  const { tree, bytes, status, error } = useStreamingNodes(source);
  return (
    <>
      <JsonViewer.Root value={tree}>{/* …same composition as above… */}</JsonViewer.Root>
      <div>
        {bytes.toLocaleString()} bytes · {status}
        {error && <span>: {error.message}</span>}
      </div>
    </>
  );
}
```

## Entry points

| Import                            | Pulls in                           | Use for                                            |
| --------------------------------- | ---------------------------------- | -------------------------------------------------- |
| `streaming-json-viewer`           | components + `ParsedJson`          | rendering; sync conversion from any JS value       |
| `streaming-json-viewer/streaming` | tokenizer + parser + ingest + hook | streaming a `string` or `ReadableStream` over time |

The core entry does not depend on the tokenizer / streaming code, so consumers who only render in-memory data don't pay for it.

## API

### `<JsonViewer.Root>`

| Prop       | Type        | Description                                                                                                                                                                 |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `value`    | `unknown`   | A `ParsedJson` instance (from `ParsedJson.from` or `useStreamingNodes`'s `tree`) or any raw JS value (auto-wrapped). Memoized by reference so a stable ref preserves state. |
| `children` | `ReactNode` | The parts (`Viewport`, etc.).                                                                                                                                               |

Renders no DOM element — sets up shared state (focus, collapse) for the parts.

### `ParsedJson`

```ts
class ParsedJson {
  readonly nodes: TreeNode[];
  constructor(nodes: TreeNode[]);
  static from(value: unknown): ParsedJson;
}
```

The "pre-built tree" handoff. Pass an instance to `<Root value={...}>` and the library uses it directly; pass anything else and the library calls `ParsedJson.from` for you (memoized on the `value` reference). Mirrors the `fetch(input)` / `new URL(input)` idiom — instances are unambiguous, raw values are auto-converted.

Use `ParsedJson.from(value)` explicitly when you want to manipulate the resulting nodes before rendering, or to lift the conversion out of render so the same instance survives reference changes.

### `useStreamingNodes` (subpath)

```ts
import { useStreamingNodes, type StreamValue } from 'streaming-json-viewer/streaming';

useStreamingNodes(
  value: StreamValue | null,
  opts?: { chunkSize?: number },
): {
  tree: ParsedJson;
  bytes: number;
  status: 'idle' | 'streaming' | 'done' | 'error';
  error: Error | null;
};
```

`StreamValue` is `string | ReadableStream<Uint8Array> | ReadableStream<string>`. The hook owns the tokenizer / parser / ingest pipeline, batches updates via `requestAnimationFrame`, and supports multiple top-level values (JSON Lines). `bytes`/`status`/`error` are yours to render however you like — `<Root>` doesn't know about them.

### `<JsonViewer.Viewport>`

Renders the virtualized scroll surface and sticky ancestor headers. Forwards HTML props and `ref`. Requires a `<JsonViewer.Content />` child. Accepts a `render` prop (base-ui convention) so the viewport element can be composed with other components — for example, `<ScrollArea.Viewport render={<JsonViewer.Viewport />}>` swaps in a base-ui custom scrollbar while preserving sticky-header behavior.

### `<JsonViewer.Content>`

Slot for the row renderer. Required as a child of `<Viewport>`. Its render-prop must return a `<JsonViewer.Group>`, whose own render-prop returns the row content. The library extracts the Group's static props (used to style the chain wrapper — see below) and calls Group's render-prop once per visible row and once per sticky pinned row, inside a `LineContext` provider.

```tsx
<JsonViewer.Content>
  {() => (
    <JsonViewer.Group>
      {() => (
        <JsonViewer.Line>
          <JsonViewer.Trigger>
            <MyChevron />
          </JsonViewer.Trigger>
          <JsonViewer.LineContent />
        </JsonViewer.Line>
      )}
    </JsonViewer.Group>
  )}
</JsonViewer.Content>
```

=>

```tsx
<JsonViewer.Content>
  {() => (
    <JsonViewer.Property>
      <JsonViewer.Line>
        <JsonViewer.Trigger>
          <MyChevron />
        </JsonViewer.Trigger>
        <JsonViewer.LineContent />
      </JsonViewer.Line>
      <JsonViewer.Children />
    </JsonViewer.Property>
  )}
</JsonViewer.Content>
```

Inside the inner render-prop, call `useLine()` to read the current row's node, depth, kind, and toggle.

### `<JsonViewer.Group>`

Wrapper for a sticky-ancestor chain. Forwards HTML props (`className`, `style`, `data-*`, `...rest`) onto each chain-wrapper `<div>` the library renders, alongside library-controlled positioning (`position: absolute`, `top`, `left:0`, `right:0`, `height`) and `data-depth={level}` for the chain level. Its `children` is the per-row render-prop. If rendered directly outside the Body extraction path, it returns `children()` (or `children` as JSX) with no DOM of its own.

### `<JsonViewer.Line>`

Row wrapper. Owns row positioning (the library applies `position`/`top`/`left`/`right`/`height`/`zIndex` inline), indent padding, and click-to-toggle. Exposes row state via data attributes for CSS:

| Attribute          | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| `data-type`        | `"object" \| "array" \| "string" \| "number" \| "boolean" \| "null"` |
| `data-collapsed`   | present when a container is collapsed                                |
| `data-empty`       | present when a container has no children                             |
| `data-clickable`   | present when clicking the row toggles a container                    |
| `data-sticky`      | present when the row is the pinned open of a sticky chain            |
| `data-sticky-last` | present when the row is the deepest pinned sticky open               |

Click anywhere on the row toggles the container (when toggleable). Children are required — compose `<Trigger>` and `<LineContent>` (or your own equivalents) inside.

### `<JsonViewer.Trigger>`

Toggle indicator. Renders `<span data-state="open|closed|none">{children}</span>`:

- `data-state="open"` — container, expanded
- `data-state="closed"` — container, collapsed
- `data-state="none"` — close row, primitive, or empty container (rendered invisible to preserve the gutter)

Children are required — typically an SVG icon. Appearance (color, rotation, transition) is userland: attach a `className` and style off `[data-state='...']`:

```css
.my-trigger {
  transition: transform 80ms;
}
.my-trigger[data-state='open'] {
  transform: rotate(90deg);
}
```

The library only sets the structural styles needed to preserve the indent gutter (fixed width + hide when `data-state='none'`). Not interactive on its own — clicks bubble to `<Line>` so the whole row remains clickable.

### `<JsonViewer.LineContent>`

Renders the tokenized content of a row inside `<span data-token="content">`. Emits per-token spans (`data-token="property" | "colon" | "bracket" | "string" | "number" | "boolean" | "null" | "ellipsis" | "count"`). Style each via the corresponding selector.

## Theming

The library ships no CSS — pass your own `className` / `style` to `<JsonViewer.Viewport>` and `<JsonViewer.Line>`, or target the documented data attributes (`[data-token]`, `[data-state]`, `[data-sticky]`) from your stylesheet.
