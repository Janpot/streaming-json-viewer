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
import type { ContainerNode, LineCursor, Status } from './types';

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

/**
 * Container for status-bar parts. Renders a plain `<div>` and passes through
 * className/style/etc. — the consumer composes its content from the leaf
 * parts (Bytes, NodeCount, LineCount, Status) with their own classes.
 */
function StatusBar(props: StatusBarProps) {
  return <div {...props} />;
}

export type StatProps = HTMLAttributes<HTMLSpanElement>;

function Bytes(props: StatProps) {
  const store = useStore();
  useStoreVersion(store);
  return <span {...props}>{store.bytes.toLocaleString()}</span>;
}

function NodeCount(props: StatProps) {
  const store = useStore();
  useStoreVersion(store);
  return <span {...props}>{store.nodes.length.toLocaleString()}</span>;
}

function LineCount(props: StatProps) {
  const store = useStore();
  useStoreVersion(store);
  return <span {...props}>{store.totalLines.toLocaleString()}</span>;
}

export type StatusProps = HTMLAttributes<HTMLSpanElement>;

/**
 * Renders the current viewer status as `<span data-status="...">{text}</span>`.
 * data-status is one of `streaming` | `done` | `error` | `idle` — style each
 * variant via `[data-status='streaming']` etc.
 */
function Status(props: StatusProps) {
  const store = useStore();
  useStoreVersion(store);
  const { status, error } = store;
  const text =
    status === 'streaming'
      ? 'streaming'
      : status === 'done'
        ? 'complete'
        : status === 'error'
          ? (error?.message ?? 'error')
          : 'idle';
  return (
    <span data-status={status} {...props}>
      {text}
    </span>
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

interface WrapperEntry {
  id: number;
  depth: number;
  lineIdx: number;
  subtreeLines: number;
}

interface VisibleEntry {
  line: LineCursor;
  idx: number;
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
  // wheel handler keeps pixel precision via `localOffset`. In that mode the
  // sticky-wrapper render path can't run (CSS sticky needs scroll positions to
  // match content positions), so we fall back to absolute-positioned rows.
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

  // Walk root → deepest non-transparent ancestor whose body covers the
  // viewport. Each entry becomes a wrapper div with a position:sticky open.
  const wrapperChain: WrapperEntry[] = [];
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
        wrapperChain.push({
          id: curId,
          depth,
          lineIdx: curOpen,
          subtreeLines: cc.subtreeLines,
        });
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
  const wrapperIds = new Set(wrapperChain.map((w) => w.id));

  // Deepest level that is currently pinned — used to mark the bottom of the
  // stacked sticky group (e.g. for a drop shadow under it).
  let lastPinnedLevel = -1;
  for (let i = 0; i < wrapperChain.length; i++) {
    const e = wrapperChain[i]!;
    if (e.lineIdx * ROW_HEIGHT < docScrollTop + e.depth * ROW_HEIGHT) lastPinnedLevel = i;
  }

  const visibleLines: VisibleEntry[] = [];
  if (totalLines > 0) {
    const first = getLineAt(startIdx, nodes);
    if (first) {
      let line: LineCursor | null = first.line;
      let i = startIdx;
      while (line && i < endIdx) {
        visibleLines.push({ line, idx: i });
        line = nextLine(nodes, line);
        i += 1;
      }
    }
  }

  const buildLineCtx = (
    entry: VisibleEntry,
    isSticky: boolean,
    toggle: () => void,
  ): LineContextValue | null => {
    const node = nodes[entry.line.id];
    if (!node) return null;
    const parent = node.parentId >= 0 ? nodes[node.parentId]! : null;
    return {
      node,
      parent,
      kind: entry.line.kind,
      depth: entry.line.depth,
      lineIdx: entry.idx,
      isSticky,
      toggle,
    };
  };

  // Bucket visible rows by deepest enclosing wrapper. Wrapper opens are
  // skipped — each wrapper renders its own sticky open. A wrapper "owns"
  // [lineIdx, lineIdx + subtreeLines - 1) — its open + middle, but NOT its
  // close. The close-row goes to the parent's bucket (or spacerBucket for the
  // root) so the close visually pushes the sticky open up, one row apart.
  const buckets: VisibleEntry[][] = wrapperChain.map(() => []);
  const spacerBucket: VisibleEntry[] = [];
  for (const item of visibleLines) {
    if (item.line.kind === 'open' && wrapperIds.has(item.line.id)) continue;
    let assigned = false;
    for (let k = wrapperChain.length - 1; k >= 0; k--) {
      const w = wrapperChain[k]!;
      if (item.idx >= w.lineIdx && item.idx < w.lineIdx + w.subtreeLines - 1) {
        buckets[k]!.push(item);
        assigned = true;
        break;
      }
    }
    if (!assigned) spacerBucket.push(item);
  }

  // translateY shifts content from doc-pixel coords into the capped-spacer
  // coord system. Zero when factor==1; equals scrollTop - docScrollTop in
  // pixel-cap mode so absolute positions land at the right viewport y.
  const translateY = scrollTop - docScrollTop;

  const renderAbsRow = (entry: VisibleEntry, top: number): ReactNode => {
    const node = nodes[entry.line.id];
    if (!node) return null;
    const ctx = buildLineCtx(entry, false, () => store.toggleCollapse(node.id));
    if (!ctx) return null;
    return (
      <LineContext.Provider key={`${entry.line.id}-${entry.line.kind}-${entry.idx}`} value={ctx}>
        <div
          className="sjv-row-wrap"
          style={{ position: 'absolute', top, left: 0, right: 0, height: ROW_HEIGHT }}
        >
          {renderRow()}
        </div>
      </LineContext.Provider>
    );
  };

  const renderWrapper = (level: number): ReactNode => {
    const entry = wrapperChain[level]!;
    const node = nodes[entry.id];
    if (!node) return null;
    const parent = node.parentId >= 0 ? nodes[node.parentId]! : null;
    const bucket = buckets[level]!;
    const nested = wrapperChain[level + 1];

    // Wrapper top is static in spacer-DOM coords (scaled by `factor` so the
    // wrapper fits the capped spacer). Top is relative to the parent wrapper
    // for nested levels, or to the spacer for level 0. No translateY here —
    // the wrapper scrolls naturally with the spacer.
    const wrapperTop =
      level === 0
        ? Math.round((entry.lineIdx * ROW_HEIGHT) / factor)
        : Math.round(((entry.lineIdx - wrapperChain[level - 1]!.lineIdx) * ROW_HEIGHT) / factor);
    // Wrapper height: scaled by factor so it stays under the browser layout
    // cap. Sticky pin/push timing is preserved because the entire wrapper
    // (top, height, sticky bound) shrinks uniformly.
    const wrapperHeight = ((entry.subtreeLines - 1) * ROW_HEIGHT) / factor;

    // CSS sticky: pin at depth*ROW_HEIGHT relative to the scroll container.
    // The wrapper's height is the range the sticky stays pinned over; when
    // the wrapper bottom approaches, sticky gets pushed up automatically.
    const pinned = entry.lineIdx * ROW_HEIGHT < docScrollTop + entry.depth * ROW_HEIGHT;

    const stickyOpenCtx: LineContextValue = {
      node,
      parent,
      kind: 'open',
      depth: entry.depth,
      lineIdx: entry.lineIdx,
      isSticky: pinned,
      toggle: pinned
        ? () => handleStickyToggle(entry.id, entry.lineIdx, level)
        : () => store.toggleCollapse(entry.id),
    };

    return (
      <div
        key={`w-${entry.id}`}
        className="sjv-wrapper"
        style={{
          position: 'absolute',
          top: wrapperTop,
          left: 0,
          right: 0,
          height: wrapperHeight,
        }}
      >
        <LineContext.Provider value={stickyOpenCtx}>
          <div
            className="sjv-wrapper-open"
            data-sticky={pinned ? '' : undefined}
            data-sticky-last={pinned && level === lastPinnedLevel ? '' : undefined}
            style={{
              position: 'sticky',
              top: entry.depth * ROW_HEIGHT,
              height: ROW_HEIGHT,
              // Outer wrappers paint above inner ones so the inner sticky
              // slides under the outer when its close pushes it up.
              zIndex: 100 - level,
            }}
          >
            {renderRow()}
          </div>
        </LineContext.Provider>
        {bucket.map((it) =>
          renderAbsRow(
            it,
            Math.round(it.idx * ROW_HEIGHT + translateY - (entry.lineIdx * ROW_HEIGHT) / factor),
          ),
        )}
        {nested ? renderWrapper(level + 1) : null}
      </div>
    );
  };

  const spacerChildren: ReactNode[] = [];
  for (const it of spacerBucket) {
    spacerChildren.push(renderAbsRow(it, Math.round(it.idx * ROW_HEIGHT + translateY)));
  }
  if (wrapperChain.length > 0) {
    spacerChildren.push(renderWrapper(0));
  }

  const mainContent: ReactNode = (
    <div className="sjv-spacer" style={{ height: spacerHeight, position: 'relative' }}>
      {spacerChildren}
    </div>
  );

  const mergedStyle: CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    ...style,
  };

  return (
    <div ref={setRefs} className={`sjv-viewport ${className ?? ''}`} style={mergedStyle} {...rest}>
      <div className="sjv-scroll" ref={scrollRef} onScroll={onScroll}>
        {mainContent}
      </div>
    </div>
  );
});

export const JsonViewer = {
  Root,
  StatusBar,
  Bytes,
  NodeCount,
  LineCount,
  Status,
  Viewport,
  Body,
  Line,
};
