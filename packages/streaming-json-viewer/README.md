# streaming-json-viewer

A streaming JSON viewer for React. Incremental parse, virtualized rendering, sticky ancestor headers.

```tsx
import { JsonViewer } from 'streaming-json-viewer';
import 'streaming-json-viewer/styles.css';

<JsonViewer.Root value={jsonStringOrStream}>
  <JsonViewer.StatusBar />
  <JsonViewer.Viewport style={{ flex: 1 }} />
</JsonViewer.Root>;
```

## API

### `<JsonViewer.Root>`

| Prop             | Type                                                        | Description                                          |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `value`          | `string \| ReadableStream<Uint8Array> \| ReadableStream<string>` | JSON source. Changing it restarts ingestion.         |
| `chunkSize`      | `number = 65536`                                            | Chunk size for string ingestion.                     |
| `onStatusChange` | `(s, err?) => void`                                         | Notified on `'idle' \| 'streaming' \| 'done' \| 'error'`. |

Renders no DOM element — sets up shared state for the parts.

### `<JsonViewer.StatusBar>`

Renders a status bar with bytes / nodes / lines / status pill. Forwards HTML props.

### `<JsonViewer.Viewport>`

Renders the virtualized scroll surface and sticky ancestor headers. Forwards HTML props and `ref`.

## Theming

Override any `--sjv-*` CSS variable on `.sjv-viewport` (or any ancestor). See `dist/styles.css` for the full list.
