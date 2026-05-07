import {
  Children,
  forwardRef,
  isValidElement,
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
import { Line, LineContext, ROW_HEIGHT, type LineContextValue } from './Row';
import type { ContainerNode, Status, StickyEntry } from './types';

const OVERSCAN = 12;
// Browsers cap the maximum height of a single element. Firefox is the strictest
// (~17M px). We stay well below that and decouple the document offset from the
// native scrollTop above this threshold so the viewer can render any number of
// rows. See https://rednegra.net/blog/20260212-virtual-scroll/#technique-4-pixel-precise-scroll
const SAFE_MAX_SPACER_HEIGHT = 8_000_000;

export interface RootProps {
  value: StreamValue;
  /** 'json' (default) parses a single top-level value. 'jsonl' / 'ndjson'
   * parses a stream of newline-separated values, wrapped in an implicit
   * top-level array. */
  format?: 'json' | 'jsonl';
  chunkSize?: number;
  onStatusChange?: (status: Status, error?: Error) => void;
  children: ReactNode;
}

function Root({ value, format = 'json', chunkSize = 65536, onStatusChange, children }: RootProps) {
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

    if (format === 'jsonl') {
      // Synthesize an implicit array root so each line lands as a child,
      // but mark it transparent so its open/close rows aren't rendered and
      // children appear at depth 0.
      builder.handlers.openArray(null);
      (builder.nodes[0] as ContainerNode).transparent = true;
    }
    const parser = createParser(builder.handlers, { multiValue: format === 'jsonl' });
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
          if (format === 'jsonl') builder.handlers.closeArray();
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
  }, [value, format, chunkSize, store]);

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

export interface BodyProps {
  children?: () => ReactNode;
}

const defaultBodyRenderer = () => <Line />;

/**
 * Slot/marker. The render-prop runs once per visible row + once per sticky row
 * inside a LineContext provider. Use `useLine()` (or render `<JsonViewer.Line />`)
 * to read the current row's data. When omitted, defaults to rendering `<JsonViewer.Line />`.
 */
function Body(_props: BodyProps): null {
  return null;
}
Body.displayName = 'JsonViewer.Body';

function findBodyRenderer(children: ReactNode): (() => ReactNode) | null {
  let found: (() => ReactNode) | null = null;
  let hasBody = false;
  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === Body) {
      hasBody = true;
      const renderer = (child.props as BodyProps).children;
      if (renderer) found = renderer;
    }
  });
  return hasBody ? (found ?? defaultBodyRenderer) : null;
}

export type ViewportProps = HTMLAttributes<HTMLDivElement> & { children?: ReactNode };

const Viewport = forwardRef<HTMLDivElement, ViewportProps>(function Viewport(
  { className, style, children, ...rest },
  forwardedRef,
) {
  const renderRow = findBodyRenderer(children);
  if (!renderRow) {
    throw new Error('JsonViewer.Viewport requires a JsonViewer.Body child');
  }
  const store = useStore();
  useStoreVersion(store);
  const { nodes, totalLines } = store;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [containerHeight, setContainerHeight] = useState(560);
  // Extra document-space pixel offset on top of the linear scrollTop mapping.
  // Used only when the document height exceeds the browser's element-height
  // cap; gives us pixel precision regardless of total size.
  const [localOffset, setLocalOffset] = useState(0);
  const programmaticScrollRef = useRef(false);

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

  // Geometry. When fullHeight exceeds SAFE_MAX_SPACER_HEIGHT, the spacer is
  // capped and `factor` > 1 turns the scrollbar into a coarse navigator. The
  // wheel handler keeps pixel precision via `localOffset`.
  const fullHeight = totalLines * ROW_HEIGHT;
  const spacerHeight = Math.max(Math.min(fullHeight, SAFE_MAX_SPACER_HEIGHT), ROW_HEIGHT);
  const scrollRange = Math.max(1, spacerHeight - containerHeight);
  const docRange = Math.max(0, fullHeight - containerHeight);
  const factor = docRange === 0 || fullHeight <= SAFE_MAX_SPACER_HEIGHT ? 1 : docRange / scrollRange;
  const docScrollTop = factor === 1 ? scrollTop : scrollTop * factor + localOffset;

  // Click-to-collapse on a sticky header should keep the row pinned at the
  // viewport y where the user clicked. We set scroll synchronously alongside
  // the collapse so the next render uses both the new tree and new scrollTop
  // in the same React batch (no in-between frame).
  const handleStickyToggle = useCallback(
    (id: number, lineIdx: number, slot: number) => {
      const targetDoc = Math.max(0, (lineIdx - slot) * ROW_HEIGHT);
      const nextScrollTop = factor === 1 ? targetDoc : Math.round(targetDoc / factor);
      const nextLocal = factor === 1 ? 0 : targetDoc - nextScrollTop * factor;
      programmaticScrollRef.current = true;
      if (scrollRef.current) scrollRef.current.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
      setLocalOffset(nextLocal);
      store.toggleCollapse(id);
    },
    [store, factor],
  );

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const next = e.currentTarget.scrollTop;
    setScrollTop(next);
    setScrollLeft(e.currentTarget.scrollLeft);
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
      return;
    }
    // Native scrollbar drag — drop any fine offset so the document position
    // matches the bar handle exactly.
    if (factor !== 1 && localOffset !== 0) setLocalOffset(0);
  };

  // Pixel-precise wheel: when clipping is active, prevent native scaled scroll
  // and advance the document offset by exactly deltaY, then resync the
  // scrollbar handle.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || factor === 1) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const nextDoc = Math.max(0, Math.min(docRange, docScrollTop + e.deltaY));
      const nextScrollTop = Math.round(nextDoc / factor);
      const nextLocal = nextDoc - nextScrollTop * factor;
      programmaticScrollRef.current = true;
      el.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
      setLocalOffset(nextLocal);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [factor, docRange, docScrollTop]);

  const startIdx = Math.max(0, Math.floor(docScrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(totalLines, Math.ceil((docScrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);

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
      const transparent = cc.transparent === true;
      if (!transparent) {
        const slotY = depth * ROW_HEIGHT;
        if (curOpen * ROW_HEIGHT >= docScrollTop + slotY) break;
        const closeIdx = curOpen + cc.subtreeLines - 1;
        if ((closeIdx + 1) * ROW_HEIGHT <= docScrollTop) break;
        stickyChain.push({ id: curId, depth, lineIdx: curOpen });
      }

      const nextDepth = transparent ? depth : depth + 1;
      const targetY = docScrollTop + nextDepth * ROW_HEIGHT;
      let childOpen = transparent ? curOpen : curOpen + 1;
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
      depth = nextDepth;
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
        <div className="sjv-spacer" style={{ height: spacerHeight, position: 'relative' }}>
          {renderRow &&
            visibleLines.map(({ line, idx }) => {
              if (!line) return null;
              const node = nodes[line.id];
              if (!node) return null;
              if (line.kind === 'open' && stickyIds.has(line.id)) return null;
              const parent = node.parentId >= 0 ? nodes[node.parentId]! : null;
              // Position relative to viewport. With factor === 1 this reduces
              // to idx * ROW_HEIGHT (rows pinned to spacer y). With clipping,
              // adding scrollTop cancels the scroll element's own scroll so the
              // row visually lands at viewport y = idx*ROW_HEIGHT - docScrollTop.
              const rowTop = idx * ROW_HEIGHT - docScrollTop + scrollTop;
              const lineCtx: LineContextValue = {
                node,
                parent,
                kind: line.kind,
                depth: line.depth,
                lineIdx: idx,
                isSticky: false,
                toggle: () => store.toggleCollapse(node.id),
              };
              return (
                <LineContext.Provider key={`${line.id}-${line.kind}-${idx}`} value={lineCtx}>
                  <div
                    className="sjv-row-wrap"
                    style={{ position: 'absolute', top: rowTop, left: 0, right: 0, height: ROW_HEIGHT }}
                  >
                    {renderRow()}
                  </div>
                </LineContext.Provider>
              );
            })}
        </div>
      </div>

      {stickyChain.length > 0 && renderRow && (
        <div className="sjv-sticky" style={{ transform: `translateX(${-scrollLeft}px)` }}>
          {stickyChain.map((entry, i) => {
            const node = nodes[entry.id];
            if (!node) return null;
            const parent = node.parentId >= 0 ? nodes[node.parentId]! : null;
            const lineCtx: LineContextValue = {
              node,
              parent,
              kind: 'open',
              depth: entry.depth,
              lineIdx: entry.lineIdx,
              isSticky: true,
              toggle: () => handleStickyToggle(node.id, entry.lineIdx, i),
            };
            return (
              <LineContext.Provider key={`s-${entry.id}`} value={lineCtx}>
                <div
                  className="sjv-sticky-row"
                  data-sticky=""
                  style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                >
                  {renderRow()}
                </div>
              </LineContext.Provider>
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
  Body,
  Line,
};
