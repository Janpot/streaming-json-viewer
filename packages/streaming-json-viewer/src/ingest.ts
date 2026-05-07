import type { Tokenizer } from './tokenizer';

export type StreamValue = string | ReadableStream<Uint8Array> | ReadableStream<string>;

export interface IngestOptions {
  signal: AbortSignal;
  onProgress: (bytes: number) => void;
  chunkSize?: number;
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
  { signal, onProgress, chunkSize = 65536 }: IngestOptions,
) {
  let pos = 0;
  while (pos < str.length) {
    if (signal.aborted) return;
    tokenizer.feed(str.slice(pos, pos + chunkSize));
    pos += chunkSize;
    onProgress(Math.min(pos, str.length));
    await new Promise((r) => setTimeout(r, 0));
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
      onProgress(received);
    }
    if (decoder) tokenizer.feed(decoder.decode());
    tokenizer.end();
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}
