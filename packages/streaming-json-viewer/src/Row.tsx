import type { CSSProperties } from 'react';
import type { ContainerNode, LineCursor, PrimitiveNode, TreeNode } from './types';

export const ROW_HEIGHT = 22;
export const INDENT = 16;

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
    <span className="sjv-chevron" style={style}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </span>
  );
}

function formatPrimitive(node: PrimitiveNode): { className: string; text: string } {
  if (node.type === 'string') {
    const s = node.value as string;
    const truncated = s.length > 200 ? s.slice(0, 200) + '…' : s;
    return { className: 'sjv-string', text: `"${truncated}"` };
  }
  if (node.type === 'number') return { className: 'sjv-number', text: String(node.value) };
  if (node.type === 'boolean') return { className: 'sjv-bool', text: String(node.value) };
  return { className: 'sjv-null', text: 'null' };
}

interface RowContentProps {
  node: TreeNode;
  parentNode: TreeNode | null;
  kind: LineCursor['kind'];
  depth: number;
  onToggle: (id: number) => void;
  isSticky?: boolean;
}

export function RowContent({ node, parentNode, kind, depth, onToggle, isSticky }: RowContentProps) {
  const isContainer = node.type === 'object' || node.type === 'array';
  const indent = depth * INDENT;
  const open = node.type === 'object' ? '{' : '[';
  const close = node.type === 'object' ? '}' : ']';
  const showKey =
    kind !== 'close' &&
    parentNode &&
    parentNode.type === 'object' &&
    node.key !== null;

  if (kind === 'close') {
    return (
      <div
        className={`sjv-row ${isSticky ? 'sjv-row-sticky' : ''}`}
        style={{ paddingLeft: indent + 8 + 14 }}
      >
        <span className="sjv-bracket">{close}</span>
      </div>
    );
  }

  if (isContainer) {
    const c = node as ContainerNode;
    const empty = c.childIds.length === 0;
    const count = c.childIds.length;
    const collapsed = c.collapsed;
    return (
      <div
        className={`sjv-row sjv-row-clickable ${isSticky ? 'sjv-row-sticky' : ''}`}
        style={{ paddingLeft: indent + 8 }}
        onClick={() => {
          if (!empty) onToggle(node.id);
        }}
      >
        <Chevron open={!collapsed} hidden={empty} />
        {showKey && (
          <>
            <span className="sjv-key">&quot;{node.key}&quot;</span>
            <span className="sjv-colon">: </span>
          </>
        )}
        <span className="sjv-bracket">{open}</span>
        {empty ? (
          <span className="sjv-bracket">{close}</span>
        ) : collapsed ? (
          <>
            <span className="sjv-ellipsis">…</span>
            <span className="sjv-bracket">{close}</span>
            <span className="sjv-count">
              {count} {node.type === 'array' ? (count === 1 ? 'item' : 'items') : count === 1 ? 'key' : 'keys'}
            </span>
          </>
        ) : (
          <span className="sjv-count">
            {count} {node.type === 'array' ? (count === 1 ? 'item' : 'items') : count === 1 ? 'key' : 'keys'}
          </span>
        )}
      </div>
    );
  }

  const { className, text } = formatPrimitive(node as PrimitiveNode);
  return (
    <div
      className={`sjv-row ${isSticky ? 'sjv-row-sticky' : ''}`}
      style={{ paddingLeft: indent + 8 + 14 }}
    >
      {showKey && (
        <>
          <span className="sjv-key">&quot;{node.key}&quot;</span>
          <span className="sjv-colon">: </span>
        </>
      )}
      <span className={className}>{text}</span>
    </div>
  );
}
