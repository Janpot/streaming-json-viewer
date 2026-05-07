import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { JsonViewerContext, useStore } from './context';
import { JsonViewerStore } from './store';
import { createTokenizer } from './tokenizer';
import { createParser } from './parser';
import { createTreeBuilder, getLineAt, nextLine } from './tree';
import { ingest, type StreamValue } from './ingest';
import { ROW_HEIGHT, RowContent } from './Row';
import type { ContainerNode, Status, StickyEntry } from './types';

const OVERSCAN = 12;

export interface RootProps {
  value: StreamValue;
  chunkSize?: number;
  onStatusChange?: (status: Status, error?: Error) => void;
  children: ReactNode;
}

function Root({ value, chunkSize = 65536, onStatusChange, children }: RootProps) {
  const storeRef = useRef<JsonViewerStore | null>(null);
  if (!storeRef.current) storeRef.current = new JsonViewerStore();
  const store = storeRef.current;

  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    const abort = new AbortController();
    const builder = createTreeBuilder();
    store.reset(builder.nodes);
    const setStatus = (s: Status, err: Error | null = null) => {
      store.setStatus(s, err);
      onStatusChangeRef.current?.(s, err ?? undefined);
    };
    setStatus('streaming');

    const parser = createParser(builder.handlers);
    const tokenizer = createTokenizer((t, v) => parser.onToken(t, v));

    let raf = 0;
    let scheduled = false;
    const scheduleFlush = () => {
      if (scheduled) return;
      scheduled = true;
      raf = requestAnimationFrame(() => {
        scheduled = false;
        store.notify();
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
              store.bytes = b;
              scheduleFlush();
            },
          });
          if (cancelled) return;
          scheduleFlush();
          setStatus('done');
        } catch (e) {
          if (cancelled) return;
          if ((e as Error).name === 'AbortError') return;
          const err = e instanceof Error ? e : new Error(String(e));
          setStatus('error', err);
        }
      })();
    });

    return () => {
      cancelled = true;
      abort.abort();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [value, chunkSize, store]);

  return <JsonViewerContext.Provider value={store}>{children}</JsonViewerContext.Provider>;
}

function useStoreVersion(store: JsonViewerStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}

export type StatusBarProps = HTMLAttributes<HTMLDivElement>;

function StatusBar({ className, ...rest }: StatusBarProps) {
  const store = useStore();
  useStoreVersion(store);
  const { bytes, status, error, totalLines, nodes } = store;
  return (
    <div className={`sjv-meta ${className ?? ''}`} {...rest}>
      <div className="sjv-meta-group">
        <span className="sjv-stat">
          <span className="sjv-stat-label">bytes</span>
          <span className="sjv-stat-value">{bytes.toLocaleString()}</span>
        </span>
        <span className="sjv-stat">
          <span className="sjv-stat-label">nodes</span>
          <span className="sjv-stat-value">{nodes.length.toLocaleString()}</span>
        </span>
        <span className="sjv-stat">
          <span className="sjv-stat-label">lines</span>
          <span className="sjv-stat-value">{totalLines.toLocaleString()}</span>
        </span>
      </div>
      <div className="sjv-meta-group">
        {status === 'streaming' && (
          <span className="sjv-status sjv-status-stream">
            <span className="sjv-pulse" /> streaming
          </span>
        )}
        {status === 'done' && <span className="sjv-status sjv-status-done">complete</span>}
        {status === 'error' && (
          <span className="sjv-status sjv-status-error">{error?.message ?? 'error'}</span>
        )}
        {status === 'idle' && <span className="sjv-status sjv-status-idle">idle</span>}
      </div>
    </div>
  );
}

export type ViewportProps = HTMLAttributes<HTMLDivElement>;

const Viewport = forwardRef<HTMLDivElement, ViewportProps>(function Viewport(
  { className, style, ...rest },
  forwardedRef,
) {
  const store = useStore();
  useStoreVersion(store);
  const { nodes, totalLines } = store;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [containerHeight, setContainerHeight] = useState(560);

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [forwardedRef],
  );

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerHeight(el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerHeight(e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Click-to-collapse on a sticky header should keep the row pinned at the
  // viewport y where the user clicked. We set scroll synchronously alongside
  // the collapse so the next render uses both the new tree and new scrollTop
  // in the same React batch (no in-between frame).
  const handleStickyToggle = useCallback(
    (id: number, lineIdx: number, slot: number) => {
      const nextScrollTop = Math.max(0, (lineIdx - slot) * ROW_HEIGHT);
      if (scrollRef.current) scrollRef.current.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
      store.toggleCollapse(id);
    },
    [store],
  );

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
    setScrollLeft(e.currentTarget.scrollLeft);
  };

  const totalHeight = Math.max(totalLines * ROW_HEIGHT, ROW_HEIGHT);
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(totalLines, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);

  // Sticky chain: walk down from root, at each depth pick the child container
  // whose doc-y range covers scrollTop + (depth+1)*RH. Include a container
  // only once its open row has scrolled strictly past its slot, and drop it
  // once its close has fully scrolled past viewport top.
  const stickyChain: StickyEntry[] = [];
  if (nodes.length > 0) {
    let curId = 0;
    let curOpen = 0;
    let depth = 0;
    for (let guard = 0; guard < 256; guard++) {
      const cur = nodes[curId];
      if (!cur || (cur.type !== 'object' && cur.type !== 'array')) break;
      const cc = cur as ContainerNode;
      if (cc.collapsed || cc.childIds.length === 0) break;
      const slotY = depth * ROW_HEIGHT;
      if (curOpen * ROW_HEIGHT >= scrollTop + slotY) break;
      const closeIdx = curOpen + cc.subtreeLines - 1;
      if ((closeIdx + 1) * ROW_HEIGHT <= scrollTop) break;
      stickyChain.push({ id: curId, depth, lineIdx: curOpen });

      const targetY = scrollTop + (depth + 1) * ROW_HEIGHT;
      let childOpen = curOpen + 1;
      let nextId = -1;
      let nextOpen = 0;
      for (const childId of cc.childIds) {
        const child = nodes[childId]!;
        const childEnd = (childOpen + child.subtreeLines) * ROW_HEIGHT;
        if (childOpen * ROW_HEIGHT <= targetY && targetY < childEnd) {
          nextId = childId;
          nextOpen = childOpen;
          break;
        }
        childOpen += child.subtreeLines;
      }
      if (nextId < 0) break;
      curId = nextId;
      curOpen = nextOpen;
      depth += 1;
    }
  }
  const stickyIds = new Set(stickyChain.map((s) => s.id));

  const visibleLines: { line: ReturnType<typeof nextLine>; idx: number }[] = [];
  if (totalLines > 0) {
    const first = getLineAt(startIdx, nodes);
    if (first) {
      let line: ReturnType<typeof nextLine> = first.line;
      let i = startIdx;
      while (line && i < endIdx) {
        visibleLines.push({ line, idx: i });
        line = nextLine(nodes, line);
        i += 1;
      }
    }
  }

  const mergedStyle: CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    ...style,
  };

  return (
    <div ref={setRefs} className={`sjv-viewport ${className ?? ''}`} style={mergedStyle} {...rest}>
      <div className="sjv-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="sjv-spacer" style={{ height: totalHeight, position: 'relative' }}>
          {visibleLines.map(({ line, idx }) => {
            if (!line) return null;
            const node = nodes[line.id];
            if (!node) return null;
            if (line.kind === 'open' && stickyIds.has(line.id)) return null;
            const parent = node.parentId >= 0 ? nodes[node.parentId]! : null;
            return (
              <div
                key={`${line.id}-${line.kind}-${idx}`}
                style={{ position: 'absolute', top: idx * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT }}
              >
                <RowContent
                  node={node}
                  parentNode={parent}
                  kind={line.kind}
                  depth={line.depth}
                  onToggle={(id) => store.toggleCollapse(id)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {stickyChain.length > 0 && (
        <div className="sjv-sticky" style={{ transform: `translateX(${-scrollLeft}px)` }}>
          {stickyChain.map((entry, i) => {
            const node = nodes[entry.id];
            if (!node) return null;
            const parent = node.parentId >= 0 ? nodes[node.parentId]! : null;
            return (
              <div
                key={`s-${entry.id}`}
                className="sjv-sticky-row"
                style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
              >
                <RowContent
                  node={node}
                  parentNode={parent}
                  kind="open"
                  depth={entry.depth}
                  onToggle={(id) => handleStickyToggle(id, entry.lineIdx, i)}
                  isSticky
                />
              </div>
            );
          })}
          <div className="sjv-sticky-shadow" style={{ top: stickyChain.length * ROW_HEIGHT }} />
        </div>
      )}
    </div>
  );
});

export const JsonViewer = {
  Root,
  StatusBar,
  Viewport,
};
