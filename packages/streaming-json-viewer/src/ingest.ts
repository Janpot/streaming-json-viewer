import type { Tokenizer } from './tokenizer';

export type StreamValue = string | ReadableStream<Uint8Array> | ReadableStream<string>;

export interface IngestOptions {
  signal: AbortSignal;
  chunkSize?: number;
  onProgress?: (bytes: number) => void;
}

const DEFAULT_YIELD_BUDGET_MS = 5;

type Scheduler = { yield?: () => Promise<void> };
const schedulerImpl: Scheduler | undefined = (globalThis as { scheduler?: Scheduler }).scheduler;

/**
 * Returns an `await`-able yield helper. On Chromium with `scheduler.yield()`
 * each call yields (cheap, resumes same task at high priority). Elsewhere the
 * helper is budget-gated: it skips the await until `budgetMs` has elapsed
 * since the last actual yield, then falls back to `setTimeout(0)`.
 */
function makeYielder(budgetMs: number = DEFAULT_YIELD_BUDGET_MS): () => Promise<void> {
  if (typeof schedulerImpl?.yield === 'function') {
    return () => schedulerImpl.yield!();
  }
  let lastYield = performance.now();
  return async () => {
    if (performance.now() - lastYield < budgetMs) return;
    await new Promise((r) => setTimeout(r, 0));
    lastYield = performance.now();
  };
}

export async function ingest(
  value: StreamValue,
  tokenizer: Tokenizer,
  opts: IngestOptions,
): Promise<void> {
  if (typeof value === 'string') {
    return ingestString(value, tokenizer, opts);
  }
  return ingestStream(value, tokenizer, opts);
}

async function ingestString(
  str: string,
  tokenizer: Tokenizer,
  { signal, chunkSize = 65536, onProgress }: IngestOptions,
) {
  const yieldToMain = makeYielder();
  let pos = 0;
  while (pos < str.length) {
    if (signal.aborted) return;
    tokenizer.feed(str.slice(pos, pos + chunkSize));
    pos += chunkSize;
    onProgress?.(Math.min(pos, str.length));
    await yieldToMain();
  }
  tokenizer.end();
}

async function ingestStream(
  stream: ReadableStream<Uint8Array> | ReadableStream<string>,
  tokenizer: Tokenizer,
  { signal, onProgress }: IngestOptions,
) {
  const reader = stream.getReader();
  const onAbort = () => reader.cancel().catch(() => {});
  signal.addEventListener('abort', onAbort);

  const yieldToMain = makeYielder();
  let received = 0;
  let decoder: TextDecoder | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (signal.aborted) return;

      let text: string;
      if (typeof value === 'string') {
        text = value;
        received += value.length;
      } else {
        if (!decoder) decoder = new TextDecoder('utf-8');
        text = decoder.decode(value, { stream: true });
        received += value.byteLength;
      }
      tokenizer.feed(text);
      onProgress?.(received);
      // Let rAF-scheduled flushes paint between chunks; for real network
      // streams the budget rarely fills (reads naturally pace themselves),
      // for in-memory tee'd streams this is what makes parsing visible.
      await yieldToMain();
    }
    if (decoder) tokenizer.feed(decoder.decode());
    tokenizer.end();
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}
