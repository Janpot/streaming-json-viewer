# streaming-json-viewer

A streaming JSON viewer for React. Incremental parse, virtualized rendering, sticky ancestor headers.

```tsx
import { JsonViewer } from 'streaming-json-viewer';
import 'streaming-json-viewer/styles.css';

<JsonViewer.Root value={jsonStringOrStream}>
  <div className="my-status-bar">
    <JsonViewer.Bytes /> bytes · <JsonViewer.NodeCount /> nodes · <JsonViewer.LineCount /> lines ·{' '}
    <JsonViewer.Status />
  </div>
  <JsonViewer.Viewport style={{ flex: 1 }}>
    <JsonViewer.Body>
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
    </JsonViewer.Body>
  </JsonViewer.Viewport>
</JsonViewer.Root>;
```

## API

### `<JsonViewer.Root>`

| Prop             | Type                                                             | Description                                               |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| `value`          | `string \| ReadableStream<Uint8Array> \| ReadableStream<string>` | JSON source. Changing it restarts ingestion.              |
| `chunkSize`      | `number = 65536`                                                 | Chunk size for string ingestion.                          |
| `onStatusChange` | `(s, err?) => void`                                              | Notified on `'idle' \| 'streaming' \| 'done' \| 'error'`. |

Renders no DOM element — sets up shared state for the parts.

### `<JsonViewer.Bytes>` · `<JsonViewer.NodeCount>` · `<JsonViewer.LineCount>`

Render `<span>`s with the running byte count, node count, and total line count from the active ingestion. Forward HTML props.

### `<JsonViewer.Status>`

Renders `<span data-status="idle | streaming | done | error">{text}</span>`. Style each variant via `[data-status='streaming']` etc. Forwards HTML props.

### `<JsonViewer.Viewport>`

Renders the virtualized scroll surface and sticky ancestor headers. Forwards HTML props and `ref`. Requires a `<JsonViewer.Body />` child.

### `<JsonViewer.Body>`

Slot for the row renderer. Required as a child of `<Viewport>`. Its render-prop must return a `<JsonViewer.Group>`, whose own render-prop returns the row content. The library extracts the Group's static props (used to style the chain wrapper — see below) and calls Group's render-prop once per visible row and once per sticky pinned row, inside a `LineContext` provider.

```tsx
<JsonViewer.Body>
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
</JsonViewer.Body>
```

Inside the inner render-prop, call `useLine()` to read the current row's node, depth, kind, and toggle.

### `<JsonViewer.Group>`

Wrapper for a sticky-ancestor chain. Forwards HTML props (`className`, `style`, `data-*`, `...rest`) onto each chain-wrapper `<div>` the library renders, alongside library-controlled positioning (`position: absolute`, `top`, `left:0`, `right:0`, `height`) and `data-depth={level}` for the chain level. Its `children` is the per-row render-prop. If rendered directly outside the Body extraction path, it returns `children()` (or `children` as JSX) with no DOM of its own.

### `<JsonViewer.Line>`

Row wrapper. Owns row positioning (the library applies `position`/`top`/`left`/`right`/`height`/`zIndex` inline), indent padding, and click-to-toggle. Exposes row state via data attributes for CSS:

| Attribute          | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| `data-kind`        | `"open"` or `"close"`                                                |
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

Override any `--sjv-*` CSS variable on `.sjv-viewport` (or any ancestor). See `dist/styles.css` for the full list.
