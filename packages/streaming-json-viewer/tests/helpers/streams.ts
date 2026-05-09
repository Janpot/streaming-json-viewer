/**
 * Builds a ReadableStream that releases `text` in N chunks with a fixed delay
 * between them. Used by streaming tests so the `streaming` status and
 * `aria-busy` are observable.
 */
export function slowStream(
  text: string,
  { chunks = 5, delayMs = 60 }: { chunks?: number; delayMs?: number } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const size = Math.max(1, Math.ceil(text.length / chunks));
  let pos = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (pos >= text.length) {
        controller.close();
        return;
      }
      const slice = text.slice(pos, pos + size);
      pos += size;
      controller.enqueue(encoder.encode(slice));
      await new Promise((r) => setTimeout(r, delayMs));
    },
  });
}

export interface ControlledStream {
  stream: ReadableStream<Uint8Array>;
  /** Push the next chunk into the stream. */
  push(chunk: string): void;
  /** Close the stream cleanly. */
  end(): void;
  /** Abort the stream with an error. */
  fail(reason?: unknown): void;
}

/**
 * A ReadableStream the test fully controls. Use this instead of `slowStream`
 * when the test needs to assert on intermediate states (e.g. `streaming`
 * status, `aria-busy`) without racing real timers.
 */
export function controlledStream(): ControlledStream {
  const encoder = new TextEncoder();
  const queued: Uint8Array[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let pendingClose = false;
  let pendingError: unknown = undefined;

  const flush = () => {
    if (!controller) return;
    while (queued.length > 0) controller.enqueue(queued.shift()!);
    if (pendingError !== undefined) {
      controller.error(pendingError);
      closed = true;
    } else if (pendingClose) {
      controller.close();
      closed = true;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      flush();
    },
  });

  return {
    stream,
    push(chunk) {
      if (closed) throw new Error('controlledStream: cannot push after close/fail');
      queued.push(encoder.encode(chunk));
      flush();
    },
    end() {
      if (closed) return;
      pendingClose = true;
      flush();
    },
    fail(reason) {
      if (closed) return;
      pendingError = reason ?? new Error('controlledStream failed');
      flush();
    },
  };
}
