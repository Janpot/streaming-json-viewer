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
// Browsers cap the maximum height of a single element. Firefox is the strictest
// (~17M px). We stay well below that and decouple the document offset from the
// native scrollTop above this threshold so the viewer can render any number of
// rows. See https://rednegra.net/blog/20260212-virtual-scroll/#technique-4-pixel-precise-scroll
const SAFE_MAX_SPACER_HEIGHT = 8_000_000;

export interface RootProps {
  /** A pre-built `ParsedJson` (from `ParsedJson.from` or the
   * `useStreamingNodes` hook's `tree`), or any raw JS value — raw values
   * are auto-wrapped via `ParsedJson.from`, memoized by reference so
   * passing the same object across renders preserves focus/collapse. */
  value: unknown;
  children: ReactNode;
}

function Root({ value, children }: RootProps) {
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
  const ctx: RootContextValue = { nodes, focusedId, setFocused, toggleCollapse, instanceId };

  return <RootContext.Provider value={ctx}>{children}</RootContext.Provider>;
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
  const { nodes, focusedId, setFocused, toggleCollapse, instanceId } = useRoot();
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
      toggleCollapse(id);
    },
    [toggleCollapse, factor],
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

  // translateY shifts content from doc-pixel coords into the capped-spacer
  // coord system. Zero when factor==1; equals scrollTop - docScrollTop in
  // pixel-cap mode so outermost positions land at the right viewport y.
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

  // Wrappers use delta-compensated positions in spacer-DOM coords so they
  // stay bounded by the spacer (which is capped at SAFE_MAX_SPACER_HEIGHT).
  // Without this, in factor>1 mode the outermost wrapper's top would be a
  // huge negative number (= translateY) and its height would be the full
  // uncompressed document height — both blow past browser element-coord
  // limits (Firefox ~17M, Chrome ~33M) and the wrapper fails to lay out.
  // The depth*RH*delta term shifts wrappers so CSS sticky's `top: depth*RH`
  // pin/pushup transitions still fire at the correct doc moments.
  // In factor==1 mode delta=0 and these formulas reduce to lineIdx*RH /
  // (subtree-1)*RH respectively — i.e. uncompressed natural positions.
  const delta = (factor - 1) / factor;
  const wrapperTopAbsFn = (lineIdx: number, depth: number) =>
    (lineIdx * ROW_HEIGHT) / factor + depth * ROW_HEIGHT * delta;

  // Recursive render — every container becomes a wrapper containing its
  // sticky open, visible interior children, and an absolute close row.
  // Wrapper positions are compressed (delta-compensated); rows inside a
  // wrapper compute their `top` dynamically against the wrapper's spacer y
  // (`row K spacer y = K*RH + translateY` in flat-row terms; subtract
  // wrapperTopAbs to get the row's `top` relative to its wrapper).
  // In factor==1 the dynamic formula reduces to a static `(K - L) * RH`.
  //
  // KNOWN ISSUE (see EXPERIMENT_NOTES.md): in factor>1 mode with deeply
  // nested chains (4+ sticky levels, e.g. the docs 15MB demo), nested
  // wrappers' compressed positions interact with CSS sticky in ways that
  // produce visual artifacts (sticky opens layering at the same depth slot
  // for sibling wrappers). The simple fixtures don't expose this; the
  // demo-mirror fixture does.
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
      const selfTopAbs = wrapperTopAbsFn(lineIdx, depth);
      const closeLineIdx = lineIdx + subtree - 1;
      // Wrapper height in CSS = uncompressed offset from wrapper's compressed
      // top to the close row's true doc-coord top. This keeps wrapper.bottom
      // in viewport coords aligned with closeRow.top, so CSS sticky's natural
      // push-up timing matches doc-coords regardless of factor. In factor=1
      // this reduces to the old (subtree-1)*RH constant. In factor>1 it is
      // scroll-dependent (varies with translateY) and bounded by scrollRange
      // + clientHeight, so it never exceeds browser element-coord limits.
      // When collapsed subtree===1 so there is no close row; height is exactly
      // ROW_HEIGHT (the formula would otherwise drift in factor>1 mode).
      const wrapperHeight = collapsed
        ? ROW_HEIGHT
        : Math.max(ROW_HEIGHT, closeLineIdx * ROW_HEIGHT + translateY - selfTopAbs);
      // Collapsed containers are never in pinnedSet (built from expanded
      // ancestors only), so `pinned` is false and the open row falls back to
      // absolute positioning — matching the prior collapsed single-row path.
      const pinned = pinnedSet.has(id);

      // Only chain-pinned wrappers get position:sticky opens. Non-chain
      // wrappers' opens are absolute at their true doc-coord viewport y —
      // otherwise sibling wrappers' compressed bounds (which overlap by
      // RH*(factor-2)/factor in factor>1 mode) cause CSS sticky to pin
      // multiple opens at the same depth slot, painting on top of each other.
      const openTopAbsolute = Math.round(lineIdx * ROW_HEIGHT + translateY - selfTopAbs);
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
          // Close `top` relative to wrapper. Equals (subtree - 1)*RH when
          // factor==1; in factor>1 mode it's scroll-dependent so the close
          // tracks its true doc-coord position.
          const closeTop = Math.round(closeLineIdx * ROW_HEIGHT + translateY - selfTopAbs);
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

      const wrapperTop = isOutermost
        ? Math.round(selfTopAbs)
        : Math.round(selfTopAbs - parentTopAbs);

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
            // Wrappers are positioning placeholders. In factor>1 mode their
            // compressed bounds overlap sibling wrappers, and a wrapper with
            // pe:auto would swallow clicks meant for the sibling's row below.
            // Rows opt back in via Line.tsx (mergedStyle.pointerEvents:'auto').
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
    // parent wrapper's spacer y. Both reduce to flat-row coords because
    // `K*RH + translateY` is the row's spacer y in either case.
    const rowTop = isOutermost
      ? Math.round(lineIdx * ROW_HEIGHT + translateY)
      : Math.round(lineIdx * ROW_HEIGHT + translateY - parentTopAbs);
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

  return (
    <div
      ref={setRefs}
      className={className}
      style={mergedStyle}
      role={role ?? 'tree'}
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

export { Root, Viewport, Body, Group };
export { Line, Trigger, LineContent } from './Line';
