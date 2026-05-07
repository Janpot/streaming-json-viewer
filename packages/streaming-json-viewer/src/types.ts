export type NodeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface BaseNode {
  id: number;
  parentId: number;
  siblingIdx: number;
  key: string | number | null;
  subtreeLines: number;
}

export interface ContainerNode extends BaseNode {
  type: 'object' | 'array';
  childIds: number[];
  childrenSum: number;
  collapsed: boolean;
  /** When true, the container's own open/close rows are not rendered and
   * its children appear at the parent's depth. Used to wrap multiple
   * top-level JSONL records under a synthetic root. */
  transparent?: boolean;
}

export interface PrimitiveNode extends BaseNode {
  type: 'string' | 'number' | 'boolean' | 'null';
  value: string | number | boolean | null;
}

export type TreeNode = ContainerNode | PrimitiveNode;

export type TokenType =
  | 'lbrace'
  | 'rbrace'
  | 'lbracket'
  | 'rbracket'
  | 'colon'
  | 'comma'
  | 'string'
  | 'number'
  | 'true'
  | 'false'
  | 'null';

export type TokenValue = string | number | undefined;

export type Status = 'idle' | 'streaming' | 'done' | 'error';

export interface LineCursor {
  id: number;
  depth: number;
  kind: 'open' | 'close';
}

export interface StickyEntry {
  id: number;
  depth: number;
  lineIdx: number;
}
