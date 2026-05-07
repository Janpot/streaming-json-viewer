import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { JsonViewerContext, useJsonViewerContext } from './context';
import { createTokenizer } from './tokenizer';
import { createParser } from './parser';
import { createTreeBuilder, getLineAt, nextLine, propagateSubtreeChange } from './tree';
import { ingest, type StreamValue } from './ingest';
import { ROW_HEIGHT, RowContent } from './Row';
import type { ContainerNode, Status, StickyEntry, TreeNode } from './types';

const OVERSCAN = 12;

export interface RootProps {
  value: StreamValue;
  chunkSize?: number;
  onStatusChange?: (status: Status, error?: Error) => void;
  children: ReactNode;
}

function Root({ value, chunkSize = 65536, onStatusChange, children }: RootProps) {
  const nodesRef = useRef<TreeNode[]>([]);
  const [version, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion((v) => v + 1), []);

  const [bytes, setBytes] = useState(0);
  const [status, setStatusState] = useState<Status>('idle');
  const [error, setError] = useState<Error | null>(null);

  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const setStatus = useCallback((s: Status, err?: Error) => {
    setStatusState(s);
    onStatusChangeRef.current?.(s, err);
  }, []);

  const totalLines = useMemo(() => {
    void version;
    const nodes = nodesRef.current;
    return nodes.length === 0 ? 0 : nodes[0]!.subtreeLines;
  }, [version]);

  const toggleCollapse = useCallback(
    (id: number) => {
      const nodes = nodesRef.current;
      const node = nodes[id];
      if (!node || (node.type !== 'object' && node.type !== 'array')) return;
      const c = node as ContainerNode;
      if (c.childIds.length === 0) return;
      c.collapsed = !c.collapsed;
      propagateSubtreeChange(nodes, id);
      bumpVersion();
    },
    [bumpVersion],
  );

  useEffect(() => {
    const abort = new AbortController();
    const builder = createTreeBuilder();
    nodesRef.current = builder.nodes;
    const parser = createParser(builder.handlers);
    const tokenizer = createTokenizer((t, v) => parser.onToken(t, v));

    setBytes(0);
    setError(null);
    setStatus('streaming');
    bumpVersion();

    let raf = 0;
    let scheduled = false;
    const scheduleFlush = () => {
      if (scheduled) return;
      scheduled = true;
      raf = requestAnimationFrame(() => {
        scheduled = false;
        bumpVersion();
      });
    };

    let cancelled = false;

    (async () => {
      try {
        await ingest(value, tokenizer, {
          signal: abort.signal,
          chunkSize,
          onProgress: (b) => {
            if (cancelled) return;
            setBytes(b);
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
        setError(err);
        setStatus('error', err);
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [value, chunkSize, bumpVersion, setStatus]);

  const ctx = useMemo(
    () => ({
      nodesRef,
      totalLines,
      bytes,
      status,
      error,
      toggleCollapse,
      version,
    }),
    [totalLines, bytes, status, error, toggleCollapse, version],
  );

  return <JsonViewerContext.Provider value={ctx}>{children}</JsonViewerContext.Provider>;
}

export type StatusBarProps = HTMLAttributes<HTMLDivElement>;

function StatusBar({ className, ...rest }: StatusBarProps) {
  const { bytes, status, error, totalLines, nodesRef, version } = useJsonViewerContext();
  void version;
  const nodeCount = nodesRef.current.length;
  return (
    <div className={`sjv-meta ${className ?? ''}`} {...rest}>
      <div className="sjv-meta-group">
        <span className="sjv-stat">
          <span className="sjv-stat-label">bytes</span>
          <span className="sjv-stat-value">{bytes.toLocaleString()}</span>
        </span>
        <span className="sjv-stat">
          <span className="sjv-stat-label">nodes</span>
          <span className="sjv-stat-value">{nodeCount.toLocaleString()}</span>
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
  const { nodesRef, totalLines, toggleCollapse, version } = useJsonViewerContext();

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
    // Measure synchronously before first paint so virtualization fills the
    // actual viewport, not a stale fallback size.
    setContainerHeight(el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerHeight(e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Collapsing a sticky should keep the clicked row pinned to the same
  // viewport y. We set scroll synchronously alongside the collapse so the
  // next render uses both the new (smaller) tree and the new scrollTop in
  // the same paint — otherwise there's a brief frame where they disagree.
  const handleStickyToggle = useCallback(
    (id: number, lineIdx: number, slot: number) => {
      const nextScrollTop = Math.max(0, (lineIdx - slot) * ROW_HEIGHT);
      if (scrollRef.current) scrollRef.current.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
      toggleCollapse(id);
    },
    [toggleCollapse],
  );

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
    setScrollLeft(e.currentTarget.scrollLeft);
  };

  const nodes = nodesRef.current;
  void version;

  const totalHeight = Math.max(totalLines * ROW_HEIGHT, ROW_HEIGHT);
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(totalLines, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);

  // Sticky chain: walk down the tree from the root, at each depth picking the
  // child container whose doc-y range contains the line that would appear just
  // below the existing sticky stack (scrollTop + (depth+1)*RH). A container is
  // included only once its open row has been scrolled strictly past its slot:
  //
  //   open*RH < scrollTop + depth*RH
  //
  // and excluded once its close row has fully scrolled past the viewport top:
  //
  //   (close+1)*RH > scrollTop
  //
  // Consequence: at scrollTop = 0 nothing is sticky; at scrollTop = 1 every
  // container along the current ancestor path becomes sticky simultaneously.
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

  const visibleLines: { line: ReturnType<typeof getLineAt> extends infer T ? T extends { line: infer L } ? L : never : never; idx: number }[] = [];
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
            // Skip rendering rows that are also in the sticky chain (avoid duplicate row).
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
                  onToggle={toggleCollapse}
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
