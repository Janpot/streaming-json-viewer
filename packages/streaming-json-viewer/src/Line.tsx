import {
  createContext,
  useContext,
  type CSSProperties,
  type FocusEventHandler,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import type { ContainerNode, LineCursor, PrimitiveNode, TreeNode } from './types';

export const ROW_HEIGHT = 22;
export const INDENT = 16;
const TRIGGER_WIDTH = 14;

export interface LineContextValue {
  node: TreeNode;
  parent: TreeNode | null;
  kind: LineCursor['kind'];
  depth: number;
  lineIdx: number;
  isSticky: boolean;
  isStickyLast: boolean;
  position: 'absolute' | 'sticky';
  top: number;
  height: number;
  zIndex?: number;
  toggle: () => void;
  /** True for the row that owns the tab stop (`tabIndex=0`). Stays set even
   * when DOM focus is outside the viewer so Tab can re-enter. */
  isFocused: boolean;
  /** True only when `isFocused` AND the viewer currently contains DOM focus.
   * Drives `data-focused` so the visible highlight clears on Tab-out. */
  hasFocus: boolean;
  focus: () => void;
  /** Update the store's focused row without scheduling a DOM-focus restore.
   * Use from focus event handlers — DOM focus is already on the row, so the
   * restore would be redundant and can leak across renders. */
  syncFocus: () => void;
  lineId: string;
}

export const LineContext = createContext<LineContextValue | null>(null);

export function useLine(): LineContextValue {
  const ctx = useContext(LineContext);
  if (!ctx) {
    throw new Error('useLine must be used inside a JsonViewer.Content row render');
  }
  return ctx;
}

interface LineShape {
  isContainer: boolean;
  empty: boolean;
  collapsed: boolean;
  isToggleable: boolean;
}

function getLineShape({ node, kind }: LineContextValue): LineShape {
  const isContainer = node.type === 'object' || node.type === 'array';
  const c = isContainer ? (node as ContainerNode) : null;
  const empty = c ? c.childIds.length === 0 : false;
  const collapsed = c ? c.collapsed : false;
  const isToggleable = isContainer && !empty && kind !== 'close';
  return { isContainer, empty, collapsed, isToggleable };
}

export type TriggerProps = HTMLAttributes<HTMLSpanElement> & { children: ReactNode };

/**
 * Toggle indicator for a row. Carries `data-state="open" | "closed" | "none"`
 * for CSS targeting (style rotation, color, etc. via the data attribute).
 * Children (the icon) are required — typically an SVG chevron. Not itself
 * interactive: click is handled by the surrounding `<Line>` so the whole row
 * remains clickable. The library only sets the structural styles needed to
 * preserve the gutter (fixed width + hide-when-`none`) — appearance is fully
 * userland.
 */
export function Trigger({ children, style, ...rest }: TriggerProps) {
  const ctx = useLine();
  const { isToggleable, collapsed } = getLineShape(ctx);
  const state = !isToggleable ? 'none' : collapsed ? 'closed' : 'open';
  const mergedStyle: CSSProperties = {
    width: TRIGGER_WIDTH,
    flex: 'none',
    display: 'inline-flex',
    visibility: state === 'none' ? 'hidden' : 'visible',
    ...style,
  };
  return (
    <span data-state={state} style={mergedStyle} {...rest}>
      {children}
    </span>
  );
}

function formatPrimitive(node: PrimitiveNode): { token: string; text: string } {
  if (node.type === 'string') {
    const s = node.value as string;
    const truncated = s.length > 200 ? s.slice(0, 200) + '…' : s;
    return { token: 'string', text: `"${truncated}"` };
  }
  if (node.type === 'number') return { token: 'number', text: String(node.value) };
  if (node.type === 'boolean') return { token: 'boolean', text: String(node.value) };
  return { token: 'null', text: 'null' };
}

function countLabel(node: ContainerNode, count: number): string {
  if (node.type === 'array') return count === 1 ? 'item' : 'items';
  return count === 1 ? 'key' : 'keys';
}

/**
 * True when this row visually terminates a value that has a following sibling
 * in its parent container — i.e., the rendered JSON needs a trailing comma
 * after this row's value. Skipped under a transparent parent (e.g. JSONL
 * records, which are not comma-separated).
 */
function needsTrailingComma(ctx: LineContextValue): boolean {
  const { node, parent, kind } = ctx;
  if (!parent || (parent.type !== 'object' && parent.type !== 'array')) return false;
  const p = parent as ContainerNode;
  if (p.transparent) return false;
  if (node.siblingIdx >= p.childIds.length - 1) return false;
  if (kind === 'close') return true;
  const isContainer = node.type === 'object' || node.type === 'array';
  if (!isContainer) return true;
  const c = node as ContainerNode;
  return c.collapsed || c.childIds.length === 0;
}

const Comma = () => (
  <span data-token="punctuation" aria-hidden="true">
    ,
  </span>
);

export type LineContentProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'>;

/**
 * Renders the tokenized content of a row inside a `<span data-token="content">`.
 * Emits per-token spans (`data-token="property" | "punctuation" | "bracket" |
 * "string" | "number" | "boolean" | "null" | "ellipsis" | "count"`).
 */
export function LineContent(props: LineContentProps) {
  const ctx = useLine();
  const { node, parent, kind } = ctx;
  const { isContainer, empty, collapsed } = getLineShape(ctx);
  const showKey = kind !== 'close' && parent && parent.type === 'object' && node.key !== null;

  const trailingComma = needsTrailingComma(ctx);

  let content: ReactNode;
  if (kind === 'close') {
    const close = node.type === 'object' ? '}' : ']';
    content = (
      <>
        <span data-token="bracket" aria-hidden="true">
          {close}
        </span>
        {trailingComma && <Comma />}
      </>
    );
  } else if (isContainer) {
    const c = node as ContainerNode;
    const open = node.type === 'object' ? '{' : '[';
    const close = node.type === 'object' ? '}' : ']';
    const count = c.childIds.length;
    const label = countLabel(c, count);
    content = (
      <>
        {showKey && (
          <>
            <span data-token="property">&quot;{node.key}&quot;</span>
            <span data-token="punctuation" aria-hidden="true">
              :{' '}
            </span>
          </>
        )}
        <span data-token="bracket" aria-hidden="true">
          {open}
        </span>
        {empty ? (
          <>
            <span data-token="bracket" aria-hidden="true">
              {close}
            </span>
            {trailingComma && <Comma />}
          </>
        ) : collapsed ? (
          <>
            <span data-token="ellipsis" aria-hidden="true">
              …
            </span>
            <span data-token="bracket" aria-hidden="true">
              {close}
            </span>
            {trailingComma && <Comma />}
            <span data-token="count">
              {count} {label}
            </span>
          </>
        ) : (
          <span data-token="count">
            {count} {label}
          </span>
        )}
      </>
    );
  } else {
    const { token, text } = formatPrimitive(node as PrimitiveNode);
    content = (
      <>
        {showKey && (
          <>
            <span data-token="property">&quot;{node.key}&quot;</span>
            <span data-token="punctuation" aria-hidden="true">
              :{' '}
            </span>
          </>
        )}
        <span data-token={token}>{text}</span>
        {trailingComma && <Comma />}
      </>
    );
  }
  return (
    <span data-token="content" {...props}>
      {content}
    </span>
  );
}

export type LineProps = HTMLAttributes<HTMLDivElement> & { children: ReactNode };

/**
 * Row wrapper. Owns row positioning (absolute or sticky), indent padding, and
 * row-level state via data attributes (`data-type`, `data-collapsed`,
 * `data-empty`, `data-clickable`, `data-focused`, `data-sticky`,
 * `data-sticky-last`). Children are required: compose
 * `<Trigger>` and `<LineContent>` (or a custom equivalent) inside.
 *
 * For accessibility, open rows render as `role="treeitem"` with
 * `aria-level`/`aria-setsize`/`aria-posinset` and (for containers)
 * `aria-expanded`. Close rows are `aria-hidden` and excluded from the AT tree
 * — the container's open row is the single treeitem for the node. Roving
 * tabindex (`tabIndex=0` on the focused row, `-1` elsewhere) keeps Tab
 * escaping the viewer.
 */
export function Line({ className, style, onClick, onFocus, children, ...rest }: LineProps) {
  const ctx = useLine();
  const {
    node,
    parent,
    kind,
    depth,
    toggle,
    position,
    top,
    height,
    zIndex,
    isSticky,
    isStickyLast,
    isFocused,
    hasFocus,
    focus,
    syncFocus,
    lineId,
  } = ctx;
  const { empty, collapsed, isContainer, isToggleable } = getLineShape(ctx);
  const mergedStyle: CSSProperties = {
    paddingLeft: depth * INDENT + 8,
    ...style,
    position,
    top,
    left: position === 'absolute' ? 0 : undefined,
    right: position === 'absolute' ? 0 : undefined,
    height,
    zIndex,
    // Wrappers above set pointer-events:none to avoid intercepting clicks in
    // overlapping compressed bounds; rows opt back in here.
    pointerEvents: 'auto',
  };

  const isClose = kind === 'close';
  const ariaProps: HTMLAttributes<HTMLDivElement> = isClose
    ? { role: 'presentation', 'aria-hidden': true }
    : {
        role: 'treeitem',
        'aria-level': depth + 1,
        'aria-setsize':
          parent && (parent.type === 'object' || parent.type === 'array')
            ? (parent as ContainerNode).childIds.length
            : 1,
        'aria-posinset': node.parentId === -1 ? 1 : node.siblingIdx + 1,
        ...(isContainer && !empty ? { 'aria-expanded': !collapsed } : null),
      };

  const handleFocus: FocusEventHandler<HTMLDivElement> = (e) => {
    onFocus?.(e);
    if (!isClose) syncFocus();
  };

  return (
    <div
      id={isClose ? undefined : lineId}
      className={className}
      style={mergedStyle}
      data-type={node.type}
      data-collapsed={collapsed ? '' : undefined}
      data-empty={empty ? '' : undefined}
      data-clickable={isToggleable ? '' : undefined}
      data-focused={!isClose && hasFocus ? '' : undefined}
      data-sticky={isSticky ? '' : undefined}
      data-sticky-last={isStickyLast ? '' : undefined}
      tabIndex={isClose ? -1 : isFocused ? 0 : -1}
      {...ariaProps}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) {
          if (!isClose) focus();
          if (isToggleable) toggle();
        }
      }}
      onFocus={handleFocus}
      {...rest}
    >
      {children}
    </div>
  );
}
