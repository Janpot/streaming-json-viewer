import {
  Children,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEventHandler,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type ReactNode,
} from 'react';
import { useRender } from '@base-ui/react/use-render';
import { SAFE_MAX_SPACER_HEIGHT } from './constants';
import { RootContext, useRoot, type RootContextValue } from './context';
import {
  deepestVisibleAncestor,
  firstOpenLine,
  getNodeLineIdx,
  getRenderDepth,
  isNodeVisible,
  lastOpenLine,
  nextOpenLine,
  prevOpenLine,
  propagateSubtreeChange,
} from './tree';
import { LineContext, ROW_HEIGHT, type LineContextValue } from './Line';
import { ParsedJson } from './sync';
import type { ContainerNode, LineCursor } from './types';

const OVERSCAN = 12;

export interface RootProps {
  /** A pre-built `ParsedJson` (from `ParsedJson.from` or the
   * `useStreamingNodes` hook's `tree`), or any raw JS value — raw values
   * are auto-wrapped via `ParsedJson.from`, memoized by reference so
   * passing the same object across renders preserves focus/collapse. */
  value: unknown;
  children: ReactNode;
  /** When `true`, only the rows in (or near) the viewport are mounted —
   * required for very large documents. When `false` (default) every row
   * is rendered to the DOM, which simplifies small payloads, find-in-page,
   * accessibility, and snapshot tests. */
  virtualized?: boolean;
}

function Root({ value, children, virtualized = false }: RootProps) {
  // Mirrors the fetch/URL/Request pattern: an instance is the unambiguous
  // pre-built handoff; anything else is auto-converted. Memoized so the
  // tree (and its ids) survives renders where `value` ref is stable.
  const tree = useMemo<ParsedJson>(
    () => (value instanceof ParsedJson ? value : ParsedJson.from(value)),
    [value],
  );
  const nodes = tree.nodes;

  const [focusedId, setFocusedIdState] = useState<number | null>(null);
  // Bumped on collapse toggle to force re-render — the toggle mutates
  // `node.collapsed` in place so no other React state changes.
  const [, setVersion] = useState(0);
  const instanceId = useId();

  useEffect(() => {
    setFocusedIdState((prev) => {
      if (prev === null) return prev;
      // If the previously focused id no longer points to a valid (non-transparent)
      // node, drop focus.
      const n = nodes[prev];
      if (!n) return null;
      if ((n.type === 'object' || n.type === 'array') && (n as ContainerNode).transparent) {
        return null;
      }
      return prev;
    });
  }, [nodes]);

  const setFocused = useCallback(
    (id: number | null) => {
      if (id === null) {
        setFocusedIdState((prev) => (prev === null ? prev : null));
        return;
      }
      const node = nodes[id];
      if (!node) return;
      // Don't focus the transparent root — it has no rendered row.
      if (
        (node.type === 'object' || node.type === 'array') &&
        (node as ContainerNode).transparent
      ) {
        return;
      }
      const target = isNodeVisible(nodes, id) ? id : deepestVisibleAncestor(nodes, id);
      if (target === null) return;
      setFocusedIdState((prev) => (prev === target ? prev : target));
    },
    [nodes],
  );

  const toggleCollapse = useCallback(
    (id: number) => {
      const node = nodes[id];
      if (!node || (node.type !== 'object' && node.type !== 'array')) return;
      const c = node as ContainerNode;
      if (c.childIds.length === 0) return;
      c.collapsed = !c.collapsed;
      propagateSubtreeChange(nodes, id);
      if (c.collapsed) {
        setFocusedIdState((prev) => {
          if (prev !== null && prev !== id && !isNodeVisible(nodes, prev)) return id;
          return prev;
        });
      }
      setVersion((v) => v + 1);
    },
    [nodes],
  );

  // A fresh ctx each render so RootContext.Provider notifies consumers on
  // every Root re-render — including the version bump from `toggleCollapse`,
  // which mutates `node.collapsed` in place and would otherwise not produce
  // any reference change for the Provider to detect.
  const ctx: RootContextValue = {
    nodes,
    focusedId,
    setFocused,
    toggleCollapse,
    instanceId,
    virtualized,
  };

  return <RootContext.Provider value={ctx}>{children}</RootContext.Provider>;
}

export interface ContentProps {
  children: () => ReactNode;
}

/**
 * Slot/marker. The render-prop must return a `<JsonViewer.Group>` whose own
 * render-prop returns the row content. The library extracts the Group's props
 * (used to style the chain wrapper) and its render-prop (called once per
 * visible row + once per sticky pinned row, inside a LineContext provider).
 */
function Content(_props: ContentProps): null {
  return null;
}
Content.displayName = 'JsonViewer.Content';

export type GroupProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  children: (() => ReactNode) | ReactNode;
};

/**
 * Slot/marker for the chain wrapper. Returned by `<JsonViewer.Content>`'s
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

function findContentRenderer(children: ReactNode): (() => ReactNode) | null {
  let found: (() => ReactNode) | null = null;
  let hasContent = false;
  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === Content) {
      hasContent = true;
      const renderer = (child.props as ContentProps).children;
      if (renderer) found = renderer;
    }
  });
  if (!hasContent) return null;
  if (!found) {
    throw new Error('JsonViewer.Content requires a render-prop child');
  }
  return found;
}

export type ViewportProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
  render?: useRender.RenderProp;
};

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
    render,
    ...rest
  },
  forwardedRef,
) {
  const contentRenderer = findContentRenderer(children);
  if (!contentRenderer) {
    throw new Error('JsonViewer.Viewport requires a JsonViewer.Content child');
  }
  const groupElement = contentRenderer();
  if (!isValidElement(groupElement) || groupElement.type !== Group) {
    throw new Error('JsonViewer.Content render-prop must return a JsonViewer.Group element');
  }
  const { children: rowRenderer, ...groupProps } = groupElement.props as GroupProps;
  if (typeof rowRenderer !== 'function') {
    throw new Error('JsonViewer.Group requires a render-prop child');
  }
  const renderRow = rowRenderer as () => ReactNode;
  const { nodes, focusedId, setFocused, toggleCollapse, instanceId, virtualized } = useRoot();
  const totalLines = nodes.length === 0 ? 0 : nodes[0]!.subtreeLines;
  const shouldFocusDomRef = useRef(false);
  // The focused row's DOM element from the previous commit, plus whether it
  // owned DOM focus then. If a later commit observes that element disconnected
  // from the document, the row was unmounted by React (virtualization eviction
  // or a re-key into a different parent) — restore focus to whatever element
  // currently represents the focused row.
  const prevFocusedElRef = useRef<Element | null>(null);
  const prevFocusedElHadFocusRef = useRef(false);
  const [hasFocusWithin, setHasFocusWithin] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  // Doc-space scroll position is the source of truth. The DOM `scrollTop` is
  // derived as `round(docScrollTop / factor)` each render. Keeping doc-space
  // as state means `factor` drift (e.g. while streaming grows `totalLines`)
  // does not silently move the position — the visual content stays put while
  // only the scrollbar thumb re-rounds.
  const [docScrollTop, setDocScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(560);
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
    setContainerHeight(Math.round(el.clientHeight));
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerHeight(Math.round(e.contentRect.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Geometry. When fullHeight exceeds SAFE_MAX_SPACER_HEIGHT, the spacer is
  // capped and `factor` > 1 turns the scrollbar into a coarse navigator. The
  // row/wrapper render path is identical regardless of factor (see `absY`
  // below); factor only feeds the scrollbar mapping and the single
  // `translateY` offset that shifts the rendered window into the capped
  // spacer.
  const fullHeight = totalLines * ROW_HEIGHT;
  // Non-virtualized mode renders every row to the DOM, so the spacer can grow
  // to the natural document height — the SAFE_MAX_SPACER_HEIGHT cap (and the
  // matching `factor` mapping) only exists to keep virtualized mode within
  // browser element-coord limits. In non-virtualized mode the DOM size will
  // bound the document long before the spacer cap would.
  const spacerHeight = virtualized
    ? Math.max(Math.min(fullHeight, SAFE_MAX_SPACER_HEIGHT), ROW_HEIGHT)
    : Math.max(fullHeight, ROW_HEIGHT);
  const scrollRange = Math.max(1, spacerHeight - containerHeight);
  const docRange = Math.max(0, fullHeight - containerHeight);
  const factor =
    !virtualized || docRange === 0 || fullHeight <= SAFE_MAX_SPACER_HEIGHT
      ? 1
      : docRange / scrollRange;
  // DOM scrollTop is derived from docScrollTop (the state). Rounding to
  // integer matches what the browser will store anyway; the rounding wobble
  // passes through `translateY` and cancels at the row/wrapper composition
  // (inner positions are not rounded again).
  const scrollTop =
    factor === 1 ? Math.round(docScrollTop) : Math.round(docScrollTop / factor);

  // Keep the DOM scrollbar in sync with the derived `scrollTop`. Fires when
  // `docScrollTop` changes (user-driven via handlers below) and also when
  // `factor` shifts under streaming (re-rounding may move the thumb by 1px).
  // `programmaticScrollRef` suppresses the resulting `onScroll` echo so we
  // don't round-trip the value back through event conversion.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || el.scrollTop === scrollTop) return;
    programmaticScrollRef.current = true;
    el.scrollTop = scrollTop;
  }, [scrollTop]);

  // Click-to-collapse on a sticky header should keep the row pinned at the
  // viewport y where the user clicked. setDocScrollTop runs synchronously
  // alongside the collapse so the next render uses both the new tree and
  // new doc position in the same React batch.
  const handleStickyToggle = useCallback(
    (id: number, lineIdx: number, slot: number) => {
      const targetDoc = Math.max(0, (lineIdx - slot) * ROW_HEIGHT);
      setDocScrollTop(targetDoc);
      // toggleCollapse may repair focus up to `id` when the focused row
      // was a hidden descendant — make sure DOM focus follows.
      shouldFocusDomRef.current = true;
      toggleCollapse(id);
    },
    [toggleCollapse],
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
      else if (lineBottom > visibleBottom) targetDoc = Math.max(0, lineBottom - containerHeight);
      if (targetDoc < 0) return;
      setDocScrollTop(targetDoc);
    },
    [docScrollTop, containerHeight],
  );

  const moveFocus = useCallback(
    (id: number) => {
      const lineIdx = getNodeLineIdx(nodes, id);
      if (lineIdx !== null) ensureLineVisible(lineIdx, getRenderDepth(nodes, id));
      shouldFocusDomRef.current = true;
      setFocused(id);
    },
    [nodes, ensureLineVisible, setFocused],
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
    const c = node.type === 'object' || node.type === 'array' ? (node as ContainerNode) : null;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        if (e.metaKey) {
          const last = lastOpenLine(nodes);
          if (last) moveFocus(last.id);
          return;
        }
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
          toggleCollapse(startCursor.id);
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
          toggleCollapse(startCursor.id);
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
          toggleCollapse(startCursor.id);
        }
        return;
      }
    }
  };

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
    } else {
      // User-initiated bar drag. Convert the DOM scrollTop back to doc-space.
      // Sub-pixel precision is dropped (the bar is coarse navigation); the
      // wheel handler below maintains precision for fine scrolling.
      const next = e.currentTarget.scrollTop;
      setDocScrollTop(factor === 1 ? next : next * factor);
    }
    userOnScroll?.(e);
  };

  // Pixel-precise wheel: when clipping is active, prevent native scaled scroll
  // and advance the document offset by exactly deltaY. The layout effect above
  // re-syncs the DOM scrollbar to the derived `scrollTop`.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || factor === 1) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setDocScrollTop((cur) => Math.max(0, Math.min(docRange, cur + e.deltaY)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [factor, docRange]);

  const startIdx = virtualized
    ? Math.max(0, Math.floor(docScrollTop / ROW_HEIGHT) - OVERSCAN)
    : 0;
  const endIdx = virtualized
    ? Math.min(totalLines, Math.ceil((docScrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN)
    : totalLines;

  // Offsets the rendered window into the capped spacer: with the browser at
  // `scrollTop`, a child at spacer-y `K*RH + translateY` (see `absY`) paints
  // at viewport-y `K*RH - docScrollTop`. Zero when factor==1 (no cap).
  const translateY = scrollTop - docScrollTop;

  // Walk root → deepest non-transparent ancestor whose body covers the
  // viewport. Used to mark `data-sticky` on currently-pinned wrappers and
  // to identify the deepest pinned ancestor for `data-sticky-last`.
  // `deepestVisuallyStickyId` is the deepest pinned ancestor whose natural
  // viewport-y has fallen below its sticky-top (= depth*ROW_HEIGHT). At rest
  // (scrollTop=0) no row is visually sticky even though the root is
  // technically pinned to its own natural top.
  const pinnedChainIds: number[] = [];
  let deepestVisuallyStickyId = -1;
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
        pinnedChainIds.push(curId);
        if ((curOpen - depth) * ROW_HEIGHT < docScrollTop) deepestVisuallyStickyId = curId;
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
  const pinnedSet = new Set(pinnedChainIds);

  // Determine which row should carry tabIndex=0. Roving tabindex pattern: only
  // one tab stop in the tree. If `focusedId` points to a row that's rendered
  // (in the visible window OR sticky-pinned as an ancestor), that row owns the
  // tab stop. Otherwise fall back to the first pinned ancestor, then to the
  // first open line in the tree.
  let effectiveFocusedId: number | null = null;
  if (focusedId !== null) {
    const focusedLineIdx = getNodeLineIdx(nodes, focusedId);
    const focusedRendered =
      pinnedSet.has(focusedId) ||
      (focusedLineIdx !== null && focusedLineIdx >= startIdx && focusedLineIdx < endIdx);
    if (focusedRendered) effectiveFocusedId = focusedId;
  }
  if (effectiveFocusedId === null) {
    if (pinnedChainIds.length > 0) {
      effectiveFocusedId = pinnedChainIds[0]!;
    } else {
      const first = firstOpenLine(nodes);
      if (first) effectiveFocusedId = first.id;
    }
  }

  // One layout model for both factor==1 and factor>1. Every row/wrapper is
  // laid out in natural coords; `absY(line)` is that flat line's position in
  // spacer-DOM coords. With the browser scrolled to `scrollTop`, absY(line)
  // paints at the correct viewport y (`line*RH - docScrollTop`) in both
  // regimes. `translateY` is 0 when factor==1 and non-zero only in factor>1,
  // where it is the single offset that shifts the rendered window into the
  // capped spacer; it cancels in every parent→child position difference, so
  // it effectively only offsets the outermost element.
  const absY = (line: number) => line * ROW_HEIGHT + translateY;

  // Recursive render — every container becomes a wrapper containing its
  // sticky open, visible interior children, and an absolute close row. Each
  // wrapper is sized to its *rendered slice*: clamped to the open row when
  // that row is in the window, and to the close row when that row is in the
  // window (so wrapper.bottom == closeRow.top and CSS sticky's push-up
  // hand-off fires there). In the deep middle, where neither edge is
  // rendered, the wrapper just spans the visible slice — which keeps the
  // sticky open pinned at depth*RH. A wrapper is therefore never taller than
  // the slice, so no element approaches browser element-coord limits
  // regardless of document size, and sibling wrappers span disjoint line
  // ranges and never overlap.
  //
  // Each wrapper passes its own spacer-y top (`selfTopAbs`) down as the
  // child's `parentTopAbs`; children position relative to that, so the nested
  // wrapper tops telescope and every row lands at its true `absY`. The
  // outermost element uses `selfTopAbs` directly (no parent to subtract).
  const renderNode = (
    id: number,
    lineIdx: number,
    depth: number,
    parentTopAbs: number,
    isOutermost: boolean,
  ): ReactNode => {
    const node = nodes[id];
    if (!node) return null;
    const subtree = node.subtreeLines;
    if (lineIdx + subtree <= startIdx || lineIdx >= endIdx) return null;

    const isContainer = node.type === 'object' || node.type === 'array';
    const c = isContainer ? (node as ContainerNode) : null;
    const isExpanded = c !== null && !c.collapsed && c.childIds.length > 0;
    const isTransparent = c?.transparent === true;
    const parent = node.parentId >= 0 ? nodes[node.parentId]! : null;

    // Transparent: pass through children with the same depth and parent
    // context (the transparent container has no own open/close rows).
    if (isExpanded && isTransparent) {
      const out: ReactNode[] = [];
      let cursor = lineIdx;
      for (const cid of c!.childIds) {
        const child = nodes[cid]!;
        const r = renderNode(cid, cursor, depth, parentTopAbs, isOutermost);
        if (r != null) out.push(r);
        cursor += child.subtreeLines;
      }
      return out.length > 0 ? <>{out}</> : null;
    }

    // Toggleable container (non-transparent, has children). Renders a wrapper
    // even when collapsed, so the open row's <Trigger> stays mounted across
    // toggles — required for the CSS rotate transition on `data-state` to fire.
    const isToggleable = c !== null && !isTransparent && c.childIds.length > 0;
    if (isToggleable) {
      const collapsed = c!.collapsed;
      const closeLineIdx = lineIdx + subtree - 1;
      // Slice the wrapper to what's rendered. Top line = the open row when
      // it's in the window, else the window start (the open is a pinned
      // ancestor scrolled above, still rendered as the sticky header). Bottom
      // line = the close row when it's in the window (wrapper.bottom ==
      // closeRow.top, close row hangs one RH below the box so sticky push-up
      // fires there), else the window end. We always reach here with
      // closeLineIdx >= startIdx (a fully-above subtree is skipped at the top
      // of renderNode), so `closeLineIdx < endIdx` means the close is
      // rendered.
      const wTopLine = Math.max(lineIdx, startIdx);
      const wBotLine = closeLineIdx < endIdx ? closeLineIdx : endIdx;
      const selfTopAbs = absY(wTopLine);
      const wrapperHeight = collapsed
        ? ROW_HEIGHT
        : Math.max(ROW_HEIGHT, (wBotLine - wTopLine) * ROW_HEIGHT);
      // Collapsed containers are never in pinnedSet (built from expanded
      // ancestors only), so `pinned` is false and the open row uses absolute
      // positioning like any single-row node.
      const pinned = pinnedSet.has(id);

      // Chain-pinned wrappers get position:sticky opens (CSS pins them at
      // depth*RH and hands off when the wrapper bottom reaches the slot).
      // Non-chain opens are absolute at their natural position relative to
      // the wrapper.
      const openTopAbsolute = absY(lineIdx) - selfTopAbs;
      const stickyOpenCtx: LineContextValue = {
        node,
        parent,
        kind: 'open',
        depth,
        lineIdx,
        isSticky: pinned && (lineIdx - depth) * ROW_HEIGHT < docScrollTop,
        isStickyLast: id === deepestVisuallyStickyId,
        position: pinned ? 'sticky' : 'absolute',
        top: pinned ? depth * ROW_HEIGHT : openTopAbsolute,
        height: ROW_HEIGHT,
        zIndex: pinned ? 100 - depth : undefined,
        toggle: pinned
          ? () => handleStickyToggle(id, lineIdx, depth)
          : () => toggleCollapse(id),
        isFocused: id === effectiveFocusedId,
        hasFocus: id === effectiveFocusedId && hasFocusWithin,
        focus: () => moveFocus(id),
        syncFocus: () => setFocused(id),
        lineId: `${instanceId}-line-${id}`,
      };

      const interior: ReactNode[] = [];
      let closeNode: ReactNode = null;
      if (!collapsed) {
        let cursor = lineIdx + 1;
        for (const cid of c!.childIds) {
          const child = nodes[cid]!;
          const r = renderNode(cid, cursor, depth + 1, selfTopAbs, false);
          if (r != null) interior.push(r);
          cursor += child.subtreeLines;
        }

        if (closeLineIdx >= startIdx && closeLineIdx < endIdx) {
          // Close `top` relative to wrapper. Equals wrapperHeight (the close
          // row sits at the wrapper's bottom edge and hangs one RH below it).
          const closeTop = absY(closeLineIdx) - selfTopAbs;
          const closeCtx: LineContextValue = {
            node,
            parent,
            kind: 'close',
            depth,
            lineIdx: closeLineIdx,
            isSticky: false,
            isStickyLast: false,
            position: 'absolute',
            top: closeTop,
            height: ROW_HEIGHT,
            toggle: () => toggleCollapse(id),
            isFocused: false,
            hasFocus: false,
            focus: () => moveFocus(id),
            syncFocus: () => setFocused(id),
            lineId: `${instanceId}-line-${id}`,
          };
          closeNode = (
            <LineContext.Provider key={`${id}-close`} value={closeCtx}>
              {renderRow()}
            </LineContext.Provider>
          );
        }
      }

      const wrapperTop = isOutermost ? selfTopAbs : selfTopAbs - parentTopAbs;

      return (
        <div
          {...groupProps}
          key={`w-${id}`}
          data-depth={depth}
          style={{
            ...(groupProps.style ?? {}),
            position: 'absolute',
            top: wrapperTop,
            left: 0,
            right: 0,
            height: wrapperHeight,
            // Wrappers are positioning placeholders; a wrapper with pe:auto
            // would swallow clicks meant for rows it visually spans. Rows opt
            // back in via Line.tsx (mergedStyle.pointerEvents:'auto').
            pointerEvents: 'none',
          }}
        >
          <LineContext.Provider value={stickyOpenCtx}>{renderRow()}</LineContext.Provider>
          {interior}
          {closeNode}
        </div>
      );
    }

    // Single-row node: primitive or empty container.
    if (lineIdx < startIdx || lineIdx >= endIdx) return null;
    // Outermost: position in spacer coords directly. Otherwise: relative to
    // the parent wrapper's spacer top.
    const rowTop = isOutermost ? absY(lineIdx) : absY(lineIdx) - parentTopAbs;
    const rowCtx: LineContextValue = {
      node,
      parent,
      kind: 'open',
      depth,
      lineIdx,
      isSticky: false,
      isStickyLast: false,
      position: 'absolute',
      top: rowTop,
      height: ROW_HEIGHT,
      toggle: c ? () => toggleCollapse(id) : () => {},
      isFocused: id === effectiveFocusedId,
      hasFocus: id === effectiveFocusedId && hasFocusWithin,
      focus: () => moveFocus(id),
      syncFocus: () => setFocused(id),
      lineId: `${instanceId}-line-${id}`,
    };
    return (
      <LineContext.Provider key={`r-${id}`} value={rowCtx}>
        {renderRow()}
      </LineContext.Provider>
    );
  };

  const spacerChildren: ReactNode = nodes.length > 0 ? renderNode(0, 0, 0, 0, true) : null;

  // Restore DOM focus to the focused row after commits where:
  //  - user interaction (click, keyboard, collapse toggle) set
  //    `shouldFocusDomRef` so the new row gets focus,
  //  - or React unmounted the focused row from under us (virtualization
  //    eviction, or a re-key from a parent change) — detected by checking
  //    whether the previous commit's focused element is still in the DOM.
  // Runs on every commit; the `shouldFocusDomRef` guard keeps background
  // notifies (streaming) from stealing focus.
  useLayoutEffect(() => {
    if (focusedId === null) {
      prevFocusedElRef.current = null;
      prevFocusedElHadFocusRef.current = false;
      return;
    }
    const el = document.getElementById(`${instanceId}-line-${focusedId}`);
    const prevEl = prevFocusedElRef.current;

    // React removed the previously focused element. Browser dropped focus to
    // body; we want to restore focus when a new element is available.
    if (prevEl && prevEl !== el && !prevEl.isConnected && prevFocusedElHadFocusRef.current) {
      shouldFocusDomRef.current = true;
    }

    if (shouldFocusDomRef.current && el) {
      const active = document.activeElement;
      // Don't steal focus if the user moved it to an element outside the
      // viewer (e.g. clicked a button) while the row was offscreen.
      const focusOutside =
        active && active !== document.body && !viewportRef.current?.contains(active);
      shouldFocusDomRef.current = false;
      if (!focusOutside && el !== active) el.focus({ preventScroll: true });
    }

    prevFocusedElRef.current = el;
    prevFocusedElHadFocusRef.current = el !== null && el === document.activeElement;
  });

  const mainContent: ReactNode = (
    <div style={{ height: spacerHeight, position: 'relative' }}>{spacerChildren}</div>
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

  return useRender({
    render,
    ref: setRefs,
    defaultTagName: 'div',
    props: {
      className,
      style: mergedStyle,
      role: role ?? 'tree',
      onScroll,
      onKeyDown,
      onFocus,
      onBlur,
      ...rest,
      children: mainContent,
    },
  });
});

export { Root, Viewport, Content, Group };
export { Line, Trigger, LineContent } from './Line';
