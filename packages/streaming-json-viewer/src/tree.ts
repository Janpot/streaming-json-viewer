import type { ContainerNode, LineCursor, PrimitiveNode, StickyEntry, TreeNode } from './types';
import type { ParserHandlers } from './parser';

export function nodeSubtreeLines(node: TreeNode): number {
  if (node.type !== 'object' && node.type !== 'array') return 1;
  if (node.transparent) return node.childrenSum;
  if (node.collapsed) return 1;
  if (node.childIds.length === 0) return 1;
  return 2 + node.childrenSum;
}

export function propagateSubtreeChange(nodes: TreeNode[], fromId: number) {
  let cur = fromId;
  while (cur !== -1) {
    const node = nodes[cur]!;
    const oldVal = node.subtreeLines;
    const newVal = nodeSubtreeLines(node);
    if (oldVal === newVal) break;
    const delta = newVal - oldVal;
    node.subtreeLines = newVal;
    if (node.parentId !== -1) {
      (nodes[node.parentId] as ContainerNode).childrenSum += delta;
    }
    cur = node.parentId;
  }
}

export interface TreeBuilder {
  nodes: TreeNode[];
  handlers: ParserHandlers;
}

export function createTreeBuilder(): TreeBuilder {
  const nodes: TreeNode[] = [];
  const containerStack: number[] = [];

  function attach(node: TreeNode): number {
    const id = nodes.length;
    node.id = id;
    if (containerStack.length > 0) {
      const parentId = containerStack[containerStack.length - 1]!;
      const parent = nodes[parentId] as ContainerNode;
      node.parentId = parentId;
      node.siblingIdx = parent.childIds.length;
      if (parent.type === 'array') node.key = parent.childIds.length;
      parent.childIds.push(id);
      parent.childrenSum += node.subtreeLines;
      nodes.push(node);
      propagateSubtreeChange(nodes, parentId);
    } else {
      node.parentId = -1;
      node.siblingIdx = 0;
      nodes.push(node);
    }
    return id;
  }

  const handlers: ParserHandlers = {
    openObject(key) {
      const node: ContainerNode = {
        id: 0,
        parentId: -1,
        siblingIdx: 0,
        type: 'object',
        key: key ?? null,
        childIds: [],
        childrenSum: 0,
        collapsed: false,
        subtreeLines: 1,
      };
      containerStack.push(attach(node));
    },
    openArray(key) {
      const node: ContainerNode = {
        id: 0,
        parentId: -1,
        siblingIdx: 0,
        type: 'array',
        key: key ?? null,
        childIds: [],
        childrenSum: 0,
        collapsed: false,
        subtreeLines: 1,
      };
      containerStack.push(attach(node));
    },
    closeObject() {
      containerStack.pop();
    },
    closeArray() {
      containerStack.pop();
    },
    value(key, v) {
      const type: PrimitiveNode['type'] =
        v === null
          ? 'null'
          : typeof v === 'string'
          ? 'string'
          : typeof v === 'number'
          ? 'number'
          : 'boolean';
      const node: PrimitiveNode = {
        id: 0,
        parentId: -1,
        siblingIdx: 0,
        type,
        key: key ?? null,
        value: v,
        subtreeLines: 1,
      };
      attach(node);
    },
  };

  return { nodes, handlers };
}

export interface LineLookupResult {
  line: LineCursor;
  path: StickyEntry[];
}

export function getLineAt(targetIdx: number, nodes: TreeNode[]): LineLookupResult | null {
  if (nodes.length === 0) return null;
  const root = nodes[0]!;
  if (targetIdx < 0 || targetIdx >= root.subtreeLines) return null;

  let curId = 0;
  let depth = 0;
  let lineIdx = 0;
  let remaining = targetIdx;
  const path: StickyEntry[] = [];

  while (true) {
    const node = nodes[curId]!;
    const isContainer = node.type === 'object' || node.type === 'array';
    const transparent = isContainer && (node as ContainerNode).transparent === true;
    if (!transparent && remaining === 0) {
      return { line: { id: curId, depth, kind: 'open' }, path };
    }

    if (!isContainer || node.collapsed || node.childIds.length === 0) return null;

    if (!transparent) {
      path.push({ id: curId, depth, lineIdx });
      remaining -= 1;
      lineIdx += 1;
    }

    let descended = false;
    for (const cid of node.childIds) {
      const cc = nodes[cid]!.subtreeLines;
      if (remaining < cc) {
        curId = cid;
        if (!transparent) depth += 1;
        descended = true;
        break;
      }
      remaining -= cc;
      lineIdx += cc;
    }
    if (!descended) {
      if (!transparent && remaining === 0) {
        return { line: { id: curId, depth, kind: 'close' }, path };
      }
      return null;
    }
  }
}

export function nextLine(nodes: TreeNode[], line: LineCursor): LineCursor | null {
  const node = nodes[line.id]!;
  const isContainer = node.type === 'object' || node.type === 'array';
  if (
    line.kind === 'open' &&
    isContainer &&
    !node.collapsed &&
    node.childIds.length > 0
  ) {
    return { id: node.childIds[0]!, depth: line.depth + 1, kind: 'open' };
  }
  let curId = line.id;
  const depth = line.depth;
  while (true) {
    const cur = nodes[curId]!;
    const parentId = cur.parentId;
    if (parentId === -1) return null;
    const parent = nodes[parentId] as ContainerNode;
    if (cur.siblingIdx < parent.childIds.length - 1) {
      return { id: parent.childIds[cur.siblingIdx + 1]!, depth, kind: 'open' };
    }
    if (parent.transparent) {
      // No close line to emit; recurse up to find the next sibling at a
      // shallower level (or end the iteration).
      curId = parentId;
      continue;
    }
    return { id: parentId, depth: depth - 1, kind: 'close' };
  }
}
