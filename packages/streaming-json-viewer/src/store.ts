import type { ContainerNode, Status, TreeNode } from './types';
import { propagateSubtreeChange } from './tree';

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
    this.notify();
  }

  setStatus(s: Status, err: Error | null = null) {
    this.status = s;
    this.error = err;
    this.notify();
  }

  toggleCollapse(id: number) {
    const node = this.nodes[id];
    if (!node || (node.type !== 'object' && node.type !== 'array')) return;
    const c = node as ContainerNode;
    if (c.childIds.length === 0) return;
    c.collapsed = !c.collapsed;
    propagateSubtreeChange(this.nodes, id);
    this.notify();
  }

  get totalLines(): number {
    return this.nodes.length === 0 ? 0 : this.nodes[0]!.subtreeLines;
  }
}
