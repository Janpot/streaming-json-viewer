import {
  Children,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FocusEventHandler,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type ReactNode,
} from 'react';
import { InstanceIdContext, JsonViewerContext, useInstanceId, useStore } from './context';
import { JsonViewerStore } from './store';
import { createTokenizer } from './tokenizer';
import { createParser } from './parser';
import {
  createTreeBuilder,
  firstOpenLine,
  getLineAt,
  getNodeLineIdx,
  getRenderDepth,
  lastOpenLine,
  nextLine,
  nextOpenLine,
  prevOpenLine,
} from './tree';
import { ingest, type StreamValue } from './ingest';
import { LineContext, ROW_HEIGHT, type LineContextValue } from './Line';
import type { ContainerNode, LineCursor, Status } from './types';

const OVERSCAN = 12;
// Browsers cap the maximum height of a single element. Firefox is the strictest
// (~17M px). We stay well below that and decouple the document offset from the
// native scrollTop above this threshold so the viewer can render any number of
// rows. See https://rednegra.net/blog/20260212-virtual-scroll/#technique-4-pixel-precise-scroll
const SAFE_MAX_SPACER_HEIGHT = 8_000_000;

export interface RootProps {
  value: StreamValue | null;
  chunkSize?: number;
  children: ReactNode;
}

function Root({ value, chunkSize = 65536, children }: RootProps) {
  const storeRef = useRef<JsonViewerStore | null>(null);
  if (!storeRef.current) storeRef.current = new JsonViewerStore();
  const store = storeRef.current;
  const instanceId = useId();

  useEffect(() => {
    const abort = new AbortController();
    const builder = createTreeBuilder();
    store.reset(builder.nodes);

    if (value === null) {
      return () => {
        abort.abort();
      };
    }

    store.setStatus('streaming');

    // Wrap input in a transparent array root so multiple top-level values
    // (JSON Lines, concatenated JSON) land as siblings at depth 0. Single-
    // value input shows as just that value — the wrapper is never rendered.
    builder.handlers.openArray(null);
    (builder.nodes[0] as ContainerNode).transparent = true;
    const parser = createParser(builder.handlers, { multiValue: true });
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
          builder.handlers.closeArray();
          scheduleFlush();
          store.setStatus('done');
        } catch (e) {
          if (cancelled) return;
          if ((e as Error).name === 'AbortError') return;
          const err = e instanceof Error ? e : new Error(String(e));
          store.setStatus('error', err);
        }
      })();
    });

    return () => {
      cancelled = true;
      abort.abort();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [value, chunkSize, store]);

  return (
    <JsonViewerContext.Provider value={store}>
      <InstanceIdContext.Provider value={instanceId}>{children}</InstanceIdContext.Provider>
    </JsonViewerContext.Provider>
  );
}

function useStoreVersion(store: JsonViewerStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}

function Bytes(props: HTMLAttributes<HTMLSpanElement>) {
  const store = useStore();
  useStoreVersion(store);
  return <span {...props}>{store.bytes.toLocaleString()}</span>;
}

const DEFAULT_STATUS_LABELS: Record<Status, string> = {
  idle: 'idle',
  streaming: 'streaming',
  done: 'complete',
  error: 'error',
};

export interface StatusLabelProps extends HTMLAttributes<HTMLSpanElement> {
  /** Per-status label overrides. Any status not present falls back to the
   * default. The `error` label, if omitted, falls back to the thrown error's
   * `message` before the default. */
  labels?: Partial<Record<Status, string>>;
}

/**
 * Renders the current ingestion status as `<span data-status="...">{label}</span>`.
 * `data-status` is one of `idle | streaming | done | error` — style each
 * variant via `[data-status='streaming']` etc. Pass `labels` to translate or
 * rename the user-facing text.
 */
function StatusLabel({ labels, ...props }: StatusLabelProps) {
  const store = useStore();
  useStoreVersion(store);
  const { status, error } = store;
  const text =
    status === 'error'
      ? (labels?.error ?? error?.message ?? DEFAULT_STATUS_LABELS.error)
      : (labels?.[status] ?? DEFAULT_STATUS_LABELS[status]);
  return (
    <span data-status={status} {...props}>
      {text}
    </span>
  );
}

export interface BodyProps {
  children: () => ReactNode;
}

/**
 * Slot/marker. The render-prop must return a `<JsonViewer.Group>` whose own
 * render-prop returns the row content. The library extracts the Group's props
 * (used to style the chain wrapper) and its render-prop (called once per
 * visible row + once per sticky pinned row, inside a LineContext provider).
 */
function Body(_props: BodyProps): null {
  return null;
}
Body.displayName = 'JsonViewer.Body';

export type GroupProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  children: (() => ReactNode) | ReactNode;
};

/**
 * Slot/marker for the chain wrapper. Place inside `<JsonViewer.Body>`'s
 * render-prop. Its props (`className`, `style`, `data-*`, ...) are applied to
 * each chain-wrapper `<div>` the library renders. Its `children` render-prop
 * is called once per visible row to produce the row content. If rendered
 * directly (dev / fallback), it returns `children()` (or `children` as JSX)
 * with no DOM of its own.
 */
function Group({ children }: GroupProps): ReactNode {
  return typeof children === 'function' ? (children as () => ReactNode)() : children;
}
Group.displayName = 'JsonViewer.Group';

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
  if (!hasBody) return null;
  if (!found) {
    throw new Error('JsonViewer.Body requires a render-prop child');
  }
  return found;
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
  {
    className,
    style,
    children,
    onScroll: userOnScroll,
    onKeyDown: userOnKeyDown,
    onFocus: userOnFocus,
    onBlur: userOnBlur,
    role,
    ...rest
  },
  forwardedRef,
) {
  const bodyRenderer = findBodyRenderer(children);
  if (!bodyRenderer) {
    throw new Error('JsonViewer.Viewport requires a JsonViewer.Body child');
  }
  const groupElement = bodyRenderer();
  if (!isValidElement(groupElement) || groupElement.type !== Group) {
    throw new Error('JsonViewer.Body render-prop must return a JsonViewer.Group element');
  }
  const { children: rowRenderer, ...groupProps } = groupElement.props as GroupProps;
  if (typeof rowRenderer !== 'function') {
    throw new Error('JsonViewer.Group requires a render-prop child');
  }
  const renderRow = rowRenderer as () => ReactNode;
  const store = useStore();
  useStoreVersion(store);
  const { nodes, totalLines, focusedId, status } = store;
  const instanceId = useInstanceId();
  const shouldFocusDomRef = useRef(false);
  const [hasFocusWithin, setHasFocusWithin] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(560);
  // Extra document-space pixel offset on top of the linear scrollTop mapping.
  // Used only when the document height exceeds the browser's element-height
  // cap; gives us pixel precision regardless of total size.
  const [localOffset, setLocalOffset] = useState(0);
  const programmaticScrollRef = useRef(false);

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      viewportRef.current = el;
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [forwardedRef],
  );

  useLayoutEffect(() => {
    const el = viewportRef.current;
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
  const factor =
    docRange === 0 || fullHeight <= SAFE_MAX_SPACER_HEIGHT ? 1 : docRange / scrollRange;
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
      if (viewportRef.current) viewportRef.current.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
      setLocalOffset(nextLocal);
      // toggleCollapse may repair focus up to `id` when the focused row
      // was a hidden descendant — make sure DOM focus follows.
      shouldFocusDomRef.current = true;
      store.toggleCollapse(id);
    },
    [store, factor],
  );

  // Scroll a line into the visible band if it's outside it. The top
  // `depth * ROW_HEIGHT` of the viewport is reserved for sticky-pinned
  // ancestors, so a row at that depth must clear that gutter to be visible —
  // otherwise it slides under the sticky headers and looks lost.
  const ensureLineVisible = useCallback(
    (lineIdx: number, depth: number) => {
      const lineTop = lineIdx * ROW_HEIGHT;
      const lineBottom = lineTop + ROW_HEIGHT;
      const stickyGutter = depth * ROW_HEIGHT;
      const visibleTop = docScrollTop + stickyGutter;
      const visibleBottom = docScrollTop + containerHeight;
      let targetDoc = -1;
      if (lineTop < visibleTop) targetDoc = Math.max(0, lineTop - stickyGutter);
      else if (lineBottom > visibleBottom)
        targetDoc = Math.max(0, lineBottom - containerHeight);
      if (targetDoc < 0) return;
      const nextScrollTop = factor === 1 ? targetDoc : Math.round(targetDoc / factor);
      const nextLocal = factor === 1 ? 0 : targetDoc - nextScrollTop * factor;
      programmaticScrollRef.current = true;
      if (viewportRef.current) viewportRef.current.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
      setLocalOffset(nextLocal);
    },
    [docScrollTop, containerHeight, factor],
  );

  const moveFocus = useCallback(
    (id: number) => {
      const lineIdx = getNodeLineIdx(nodes, id);
      if (lineIdx !== null) ensureLineVisible(lineIdx, getRenderDepth(nodes, id));
      shouldFocusDomRef.current = true;
      store.setFocused(id);
    },
    [nodes, ensureLineVisible, store],
  );

  const onKeyDown: KeyboardEventHandler<HTMLDivElement> = (e) => {
    userOnKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (nodes.length === 0) return;

    const startCursor: LineCursor | null =
      focusedId !== null && nodes[focusedId]
        ? { id: focusedId, depth: getRenderDepth(nodes, focusedId), kind: 'open' }
        : firstOpenLine(nodes);
    if (!startCursor) return;
    const node = nodes[startCursor.id]!;
    const c =
      node.type === 'object' || node.type === 'array' ? (node as ContainerNode) : null;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = focusedId === null ? startCursor : nextOpenLine(nodes, startCursor);
        if (next) moveFocus(next.id);
        return;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = focusedId === null ? startCursor : prevOpenLine(nodes, startCursor);
        if (prev) moveFocus(prev.id);
        return;
      }
      case 'ArrowRight': {
        e.preventDefault();
        if (focusedId === null) {
          moveFocus(startCursor.id);
          return;
        }
        if (!c || c.childIds.length === 0) return;
        if (c.collapsed) {
          shouldFocusDomRef.current = true;
          store.toggleCollapse(startCursor.id);
        } else moveFocus(c.childIds[0]!);
        return;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        if (focusedId === null) {
          moveFocus(startCursor.id);
          return;
        }
        if (c && !c.collapsed && c.childIds.length > 0) {
          shouldFocusDomRef.current = true;
          store.toggleCollapse(startCursor.id);
          return;
        }
        let pId = node.parentId;
        while (pId !== -1) {
          const p = nodes[pId]!;
          const isContainer = p.type === 'object' || p.type === 'array';
          if (!isContainer || !(p as ContainerNode).transparent) break;
          pId = p.parentId;
        }
        if (pId !== -1) moveFocus(pId);
        return;
      }
      case 'Home': {
        e.preventDefault();
        const first = firstOpenLine(nodes);
        if (first) moveFocus(first.id);
        return;
      }
      case 'End': {
        e.preventDefault();
        const last = lastOpenLine(nodes);
        if (last) moveFocus(last.id);
        return;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (focusedId === null) {
          moveFocus(startCursor.id);
          return;
        }
        if (c && c.childIds.length > 0) {
          shouldFocusDomRef.current = true;
          store.toggleCollapse(startCursor.id);
        }
        return;
      }
    }
  };

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const next = e.currentTarget.scrollTop;
    setScrollTop(next);
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
    } else if (factor !== 1 && localOffset !== 0) {
      // Native scrollbar drag — drop any fine offset so the document position
      // matches the bar handle exactly.
      setLocalOffset(0);
    }
    userOnScroll?.(e);
  };

  // Pixel-precise wheel: when clipping is active, prevent native scaled scroll
  // and advance the document offset by exactly deltaY, then resync the
  // scrollbar handle.
  useEffect(() => {
    const el = viewportRef.current;
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
  const endIdx = Math.min(
    totalLines,
    Math.ceil((docScrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN,
  );

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

  // Determine which row should carry tabIndex=0. Roving tabindex pattern: only
  // one tab stop in the tree. If `focusedId` points to a rendered open row,
  // that row owns the tab stop. Otherwise (focus offscreen, focus null, or
  // focus on a collapsed branch) fall back to the first rendered open row so
  // Tab can still enter the tree.
  const renderedOpenIds = new Set<number>();
  for (const w of wrapperChain) renderedOpenIds.add(w.id);
  for (const it of visibleLines) {
    if (it.line.kind === 'open' && !wrapperIds.has(it.line.id)) {
      renderedOpenIds.add(it.line.id);
    }
  }
  let effectiveFocusedId: number | null = null;
  if (focusedId !== null && renderedOpenIds.has(focusedId)) {
    effectiveFocusedId = focusedId;
  } else if (wrapperChain.length > 0) {
    effectiveFocusedId = wrapperChain[0]!.id;
  } else {
    for (const it of visibleLines) {
      if (it.line.kind === 'open' && !wrapperIds.has(it.line.id)) {
        effectiveFocusedId = it.line.id;
        break;
      }
    }
  }

  type CtxExtras = Pick<
    LineContextValue,
    'isSticky' | 'isStickyLast' | 'position' | 'top' | 'height' | 'zIndex' | 'toggle'
  >;
  const buildLineCtx = (entry: VisibleEntry, extras: CtxExtras): LineContextValue | null => {
    const node = nodes[entry.line.id];
    if (!node) return null;
    const parent = node.parentId >= 0 ? nodes[node.parentId]! : null;
    const isOpen = entry.line.kind === 'open';
    const isFocused = isOpen && entry.line.id === effectiveFocusedId;
    return {
      node,
      parent,
      kind: entry.line.kind,
      depth: entry.line.depth,
      lineIdx: entry.idx,
      ...extras,
      isFocused,
      hasFocus: isFocused && hasFocusWithin,
      focus: () => moveFocus(node.id),
      syncFocus: () => store.setFocused(node.id),
      lineId: `${instanceId}-line-${node.id}`,
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
    const ctx = buildLineCtx(entry, {
      isSticky: false,
      isStickyLast: false,
      position: 'absolute',
      top,
      height: ROW_HEIGHT,
      toggle: () => store.toggleCollapse(node.id),
    });
    if (!ctx) return null;
    return (
      <LineContext.Provider key={`${entry.line.id}-${entry.line.kind}-${entry.idx}`} value={ctx}>
        {renderRow()}
      </LineContext.Provider>
    );
  };

  // Per-wrapper offset that compensates for the factor>1 compression so CSS
  // sticky's pin/push transitions land at the exact doc moment they would in
  // factor==1. Zero when factor==1 (delta = 0).
  const delta = (factor - 1) / factor;
  const wrapperTopAbs = (entry: WrapperEntry) =>
    (entry.lineIdx * ROW_HEIGHT) / factor + entry.depth * ROW_HEIGHT * delta;

  const renderWrapper = (level: number): ReactNode => {
    const entry = wrapperChain[level]!;
    const node = nodes[entry.id];
    if (!node) return null;
    const parent = node.parentId >= 0 ? nodes[node.parentId]! : null;
    const bucket = buckets[level]!;
    const nested = wrapperChain[level + 1];

    // Wrapper top is static in spacer-DOM coords. The depth*RH*delta term
    // shifts the wrapper down so that, after CSS sticky's `top: depth*RH`
    // offset, the pin/pushup transitions match the doc-coord moments they
    // would in factor==1 mode (no early pin, no early pushup).
    const topAbs = wrapperTopAbs(entry);
    const wrapperTop =
      level === 0
        ? Math.round(topAbs)
        : Math.round(topAbs - wrapperTopAbs(wrapperChain[level - 1]!));
    // Adding RH*delta keeps the wrapper bottom aligned with the close-row's
    // scroll-coord position, so sticky pushup fires exactly at the close.
    const wrapperHeight = ((entry.subtreeLines - 1) * ROW_HEIGHT) / factor + ROW_HEIGHT * delta;

    // CSS sticky: pin at depth*ROW_HEIGHT relative to the scroll container.
    // The wrapper's height is the range the sticky stays pinned over; when
    // the wrapper bottom approaches, sticky gets pushed up automatically.
    const pinned = entry.lineIdx * ROW_HEIGHT < docScrollTop + entry.depth * ROW_HEIGHT;

    // Outer wrappers paint above inner ones so the inner sticky slides under
    // the outer when its close pushes it up.
    const stickyOpenCtx: LineContextValue = {
      node,
      parent,
      kind: 'open',
      depth: entry.depth,
      lineIdx: entry.lineIdx,
      isSticky: pinned,
      isStickyLast: pinned && level === lastPinnedLevel,
      position: 'sticky',
      top: entry.depth * ROW_HEIGHT,
      height: ROW_HEIGHT,
      zIndex: 100 - level,
      toggle: pinned
        ? () => handleStickyToggle(entry.id, entry.lineIdx, level)
        : () => store.toggleCollapse(entry.id),
      isFocused: entry.id === effectiveFocusedId,
      hasFocus: entry.id === effectiveFocusedId && hasFocusWithin,
      focus: () => moveFocus(entry.id),
      syncFocus: () => store.setFocused(entry.id),
      lineId: `${instanceId}-line-${entry.id}`,
    };

    return (
      <div
        {...groupProps}
        key={`w-${entry.id}`}
        data-depth={level}
        style={{
          ...(groupProps.style ?? {}),
          position: 'absolute',
          top: wrapperTop,
          left: 0,
          right: 0,
          height: wrapperHeight,
        }}
      >
        <LineContext.Provider value={stickyOpenCtx}>{renderRow()}</LineContext.Provider>
        {bucket.map((it) =>
          renderAbsRow(it, Math.round(it.idx * ROW_HEIGHT + translateY - topAbs)),
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

  // After a render where focusedId was changed by user interaction (click,
  // keyboard, onFocus) — OR a render where the DOM element for the same
  // focusedId got remounted (e.g., a wrapper collapse re-renders the row
  // from a sticky position to an absolute one) — restore DOM focus to the
  // matching row. Runs on every commit, guarded by `shouldFocusDomRef` so
  // background notifies (streaming) never steal focus.
  useLayoutEffect(() => {
    if (focusedId === null) return;
    if (!shouldFocusDomRef.current) return;
    shouldFocusDomRef.current = false;
    const el = document.getElementById(`${instanceId}-line-${focusedId}`);
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  });

  const mainContent: ReactNode = (
    <div style={{ height: spacerHeight, position: 'relative' }}>
      {spacerChildren}
    </div>
  );

  const mergedStyle: CSSProperties = {
    position: 'relative',
    overflow: 'auto',
    overscrollBehavior: 'none',
    scrollbarGutter: 'stable',
    contain: 'strict',
    boxSizing: 'border-box',
    ...style,
  };

  const onFocus: FocusEventHandler<HTMLDivElement> = (e) => {
    setHasFocusWithin(true);
    userOnFocus?.(e);
  };

  const onBlur: FocusEventHandler<HTMLDivElement> = (e) => {
    // Only flip off when focus moves outside the viewer. Focus moves between
    // rows inside fire blur with relatedTarget pointing at the new row, which
    // is still inside `viewportRef`, so we keep `hasFocusWithin` true.
    const next = e.relatedTarget as Node | null;
    if (!next || !viewportRef.current?.contains(next)) {
      setHasFocusWithin(false);
    }
    userOnBlur?.(e);
  };

  return (
    <div
      ref={setRefs}
      className={className}
      style={mergedStyle}
      role={role ?? 'tree'}
      aria-busy={status === 'streaming' ? true : undefined}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      {...rest}
    >
      {mainContent}
    </div>
  );
});

export { Root, Bytes, StatusLabel, Viewport, Body, Group };
export { Line, Trigger, LineContent } from './Line';
