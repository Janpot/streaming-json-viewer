import { createContext, useContext } from 'react';
import type { Status, TreeNode } from './types';

export interface JsonViewerContextValue {
  nodesRef: { current: TreeNode[] };
  totalLines: number;
  bytes: number;
  status: Status;
  error: Error | null;
  toggleCollapse: (id: number) => void;
  version: number;
}

export const JsonViewerContext = createContext<JsonViewerContextValue | null>(null);

export function useJsonViewerContext(): JsonViewerContextValue {
  const ctx = useContext(JsonViewerContext);
  if (!ctx) {
    throw new Error('JsonViewer parts must be rendered inside <JsonViewer.Root>');
  }
  return ctx;
}
