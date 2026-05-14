import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createTokenizer } from './tokenizer';
import { createParser } from './parser';
import { createTreeBuilder } from './tree';
import { ingest, type StreamValue } from './ingest';
import { ParsedJson } from './sync';
import type { ContainerNode, Status } from './types';

export type { StreamValue } from './ingest';
export type { Status } from './types';

export interface UseStreamingNodesOptions {
  chunkSize?: number;
}

export interface StreamingNodesResult {
  tree: ParsedJson;
  bytes: number;
  status: Status;
  error: Error | null;
}

const INITIAL: StreamingNodesResult = {
  tree: new ParsedJson([]),
  bytes: 0,
  status: 'idle',
  error: null,
};

/**
 * Tiny private store. Drives renders via `useSyncExternalStore`, which
 * schedules updates on React's SyncLane — important during streaming
 * because the ingestion loop yields at the same task priority via
 * `scheduler.yield()`, and a regular `useState` setter on DefaultLane
 * would otherwise be starved until ingestion finished.
 */
class StreamingStore {
  state: StreamingNodesResult = INITIAL;
  private listeners = new Set<() => void>();

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getSnapshot = () => this.state;

  set = (next: StreamingNodesResult) => {
    this.state = next;
    for (const l of this.listeners) l();
  };
}

/**
 * Streams a `StreamValue` (string or `ReadableStream`) into a `ParsedJson`
 * suitable for `<JsonViewer.Root value={...}>`. Returns parsing state
 * (`bytes`, `status`, `error`) alongside the live tree so consumers
 * can render their own progress UI / parse-error affordance.
 *
 * Re-renders are scheduled via `requestAnimationFrame`; the underlying
 * nodes array is mutated in place, but each flush wraps it in a fresh
 * `ParsedJson` instance so React detects the change.
 */
export function useStreamingNodes(
  value: StreamValue | null,
  opts: UseStreamingNodesOptions = {},
): StreamingNodesResult {
  const { chunkSize = 65536 } = opts;
  const storeRef = useRef<StreamingStore | null>(null);
  if (storeRef.current === null) storeRef.current = new StreamingStore();
  const store = storeRef.current;

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    const abort = new AbortController();
    const builder = createTreeBuilder();

    if (value === null) {
      store.set({ tree: new ParsedJson(builder.nodes), bytes: 0, status: 'idle', error: null });
      return () => abort.abort();
    }

    // Wrap input in a transparent array root so multiple top-level values
    // (JSON Lines, concatenated JSON) land as siblings at depth 0.
    builder.handlers.openArray(null);
    (builder.nodes[0] as ContainerNode).transparent = true;
    const parser = createParser(builder.handlers, { multiValue: true });
    const tokenizer = createTokenizer((t, v) => parser.onToken(t, v));

    store.set({ tree: new ParsedJson(builder.nodes), bytes: 0, status: 'streaming', error: null });

    let raf = 0;
    let scheduled = false;
    let currentBytes = 0;
    const scheduleFlush = () => {
      if (scheduled) return;
      scheduled = true;
      raf = requestAnimationFrame(() => {
        scheduled = false;
        store.set({
          ...store.state,
          tree: new ParsedJson(builder.nodes),
          bytes: currentBytes,
        });
      });
    };

    let cancelled = false;

    // Defer reader attachment by a microtask so React StrictMode's dev
    // double-invocation (setup → cleanup → setup) doesn't lock the stream
    // before the first cleanup can mark itself cancelled.
    queueMicrotask(() => {
      if (cancelled) return;
      (async () => {
        try {
          await ingest(value, tokenizer, {
            signal: abort.signal,
            chunkSize,
            onProgress: (b) => {
              if (cancelled) return;
              currentBytes = b;
              scheduleFlush();
            },
          });
          if (cancelled) return;
          builder.handlers.closeArray();
          store.set({
            ...store.state,
            tree: new ParsedJson(builder.nodes),
            bytes: currentBytes,
            status: 'done',
            error: null,
          });
        } catch (e) {
          if (cancelled) return;
          if ((e as Error).name === 'AbortError') return;
          const err = e instanceof Error ? e : new Error(String(e));
          store.set({
            ...store.state,
            tree: new ParsedJson(builder.nodes),
            status: 'error',
            error: err,
          });
        }
      })();
    });

    return () => {
      cancelled = true;
      abort.abort();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [value, chunkSize, store]);

  return state;
}
