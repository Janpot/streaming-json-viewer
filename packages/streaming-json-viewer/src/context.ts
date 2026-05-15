import { createContext, useContext } from 'react';
import type { TreeNode } from './types';

export interface RootContextValue {
  nodes: TreeNode[];
  focusedId: number | null;
  setFocused: (id: number | null) => void;
  toggleCollapse: (id: number) => void;
  instanceId: string;
  virtualized: boolean;
}

export const RootContext = createContext<RootContextValue | null>(null);

export function useRoot(): RootContextValue {
  const ctx = useContext(RootContext);
  if (!ctx) {
    throw new Error('JsonViewer parts must be rendered inside <JsonViewer.Root>');
  }
  return ctx;
}
