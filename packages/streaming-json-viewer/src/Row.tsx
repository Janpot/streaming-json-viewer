import { createContext, useContext, type CSSProperties, type HTMLAttributes } from 'react';
import type { ContainerNode, LineCursor, PrimitiveNode, TreeNode } from './types';

export const ROW_HEIGHT = 22;
export const INDENT = 16;

export interface LineContextValue {
  node: TreeNode;
  parent: TreeNode | null;
  kind: LineCursor['kind'];
  depth: number;
  lineIdx: number;
  isSticky: boolean;
  toggle: () => void;
}

export const LineContext = createContext<LineContextValue | null>(null);

export function useLine(): LineContextValue {
  const ctx = useContext(LineContext);
  if (!ctx) {
    throw new Error('useLine must be used inside a JsonViewer.Body row render');
  }
  return ctx;
}

interface ChevronProps {
  open: boolean;
  hidden: boolean;
}

function Chevron({ open, hidden }: ChevronProps) {
  const style: CSSProperties = {
    visibility: hidden ? 'hidden' : 'visible',
    transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
  };
  return (
    <span data-token="chevron" style={style}>
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
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

export type LineProps = HTMLAttributes<HTMLDivElement>;

export function Line({ className, style, onClick, ...rest }: LineProps) {
  const { node, parent, kind, depth, toggle } = useLine();
  const isContainer = node.type === 'object' || node.type === 'array';
  const indent = depth * INDENT;
  const open = node.type === 'object' ? '{' : '[';
  const close = node.type === 'object' ? '}' : ']';
  const showKey = kind !== 'close' && parent && parent.type === 'object' && node.key !== null;

  if (kind === 'close') {
    const mergedStyle: CSSProperties = { paddingLeft: indent + 8 + 14, ...style };
    return (
      <div className={className} style={mergedStyle} onClick={onClick} {...rest}>
        <span data-token="bracket">{close}</span>
      </div>
    );
  }

  if (isContainer) {
    const c = node as ContainerNode;
    const empty = c.childIds.length === 0;
    const count = c.childIds.length;
    const collapsed = c.collapsed;
    const mergedStyle: CSSProperties = { paddingLeft: indent + 8, ...style };
    return (
      <div
        className={className}
        data-clickable={!empty ? '' : undefined}
        style={mergedStyle}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented && !empty) toggle();
        }}
        {...rest}
      >
        <Chevron open={!collapsed} hidden={empty} />
        {showKey && (
          <>
            <span data-token="property">&quot;{node.key}&quot;</span>
            <span data-token="colon">: </span>
          </>
        )}
        <span data-token="bracket">{open}</span>
        {empty ? (
          <span data-token="bracket">{close}</span>
        ) : collapsed ? (
          <>
            <span data-token="ellipsis">…</span>
            <span data-token="bracket">{close}</span>
            <span data-token="count">
              {count}{' '}
              {node.type === 'array'
                ? count === 1
                  ? 'item'
                  : 'items'
                : count === 1
                  ? 'key'
                  : 'keys'}
            </span>
          </>
        ) : (
          <span data-token="count">
            {count}{' '}
            {node.type === 'array'
              ? count === 1
                ? 'item'
                : 'items'
              : count === 1
                ? 'key'
                : 'keys'}
          </span>
        )}
      </div>
    );
  }

  const { token, text } = formatPrimitive(node as PrimitiveNode);
  const mergedStyle: CSSProperties = { paddingLeft: indent + 8 + 14, ...style };
  return (
    <div className={className} style={mergedStyle} onClick={onClick} {...rest}>
      {showKey && (
        <>
          <span data-token="property">&quot;{node.key}&quot;</span>
          <span data-token="colon">: </span>
        </>
      )}
      <span data-token={token}>{text}</span>
    </div>
  );
}
