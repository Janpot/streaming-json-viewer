import { createContext, useContext } from 'react';
import type { JsonViewerStore } from './store';

export const JsonViewerContext = createContext<JsonViewerStore | null>(null);

export function useStore(): JsonViewerStore {
  const store = useContext(JsonViewerContext);
  if (!store) {
    throw new Error('JsonViewer parts must be rendered inside <JsonViewer.Root>');
  }
  return store;
}
