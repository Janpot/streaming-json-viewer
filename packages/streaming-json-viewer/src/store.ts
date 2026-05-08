import type { ContainerNode, Status, TreeNode } from './types';
import { deepestVisibleAncestor, isNodeVisible, propagateSubtreeChange } from './tree';

/**
 * External store for a single JsonViewer instance. Holds the parsed tree and
 * ingestion state. Mutations call `notify()`; React subscribes via
 * `useSyncExternalStore` and re-renders against the latest snapshot.
 */
export class JsonViewerStore {
  nodes: TreeNode[] = [];
  bytes = 0;
  status: Status = 'idle';
  error: Error | null = null;
  focusedId: number | null = null;

  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getVersion = () => this.version;

  notify = () => {
    this.version += 1;
    for (const l of this.listeners) l();
  };

  reset(nodes: TreeNode[]) {
    this.nodes = nodes;
    this.bytes = 0;
    this.status = 'idle';
    this.error = null;
    this.focusedId = null;
    this.notify();
  }

  setStatus(s: Status, err: Error | null = null) {
    this.status = s;
    this.error = err;
    this.notify();
  }

  setFocused(id: number | null) {
    if (id === null) {
      if (this.focusedId === null) return;
      this.focusedId = null;
      this.notify();
      return;
    }
    const node = this.nodes[id];
    if (!node) return;
    // Don't focus the transparent root — it has no rendered row.
    if (
      (node.type === 'object' || node.type === 'array') &&
      (node as ContainerNode).transparent
    ) {
      return;
    }
    const target = isNodeVisible(this.nodes, id) ? id : deepestVisibleAncestor(this.nodes, id);
    if (target === null || target === this.focusedId) return;
    this.focusedId = target;
    this.notify();
  }

  toggleCollapse(id: number) {
    const node = this.nodes[id];
    if (!node || (node.type !== 'object' && node.type !== 'array')) return;
    const c = node as ContainerNode;
    if (c.childIds.length === 0) return;
    c.collapsed = !c.collapsed;
    propagateSubtreeChange(this.nodes, id);
    if (
      c.collapsed &&
      this.focusedId !== null &&
      this.focusedId !== id &&
      !isNodeVisible(this.nodes, this.focusedId)
    ) {
      this.focusedId = id;
    }
    this.notify();
  }

  get totalLines(): number {
    return this.nodes.length === 0 ? 0 : this.nodes[0]!.subtreeLines;
  }
}
