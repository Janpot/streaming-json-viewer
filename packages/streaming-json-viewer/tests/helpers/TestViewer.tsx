import { JsonViewer } from 'streaming-json-viewer';
import { useStreamingNodes, type StreamValue } from 'streaming-json-viewer/streaming';
import type { CSSProperties } from 'react';
import type React from 'react';

export interface TestViewerProps {
  value: StreamValue | null;
  height?: number;
  width?: number;
  chunkSize?: number;
  showStatusBar?: boolean;
  /** A button after the viewer so tests can shift focus out and Tab back in. */
  withTrailingButton?: boolean;
  /** Defaults to `true` — existing suites exercise the virtualized path. */
  virtualized?: boolean;
  /** Defaults to `true` (the library default). Set `false` to exercise the
   * non-pinned path. */
  sticky?: boolean;
  onViewportBlur?: (e: React.FocusEvent<HTMLDivElement>) => void;
  onViewportFocus?: (e: React.FocusEvent<HTMLDivElement>) => void;
}

const DEFAULT_HEIGHT = 480;
const DEFAULT_WIDTH = 800;

const Chevron = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </svg>
);

export function TestViewer({
  value,
  height = DEFAULT_HEIGHT,
  width = DEFAULT_WIDTH,
  chunkSize,
  showStatusBar = true,
  withTrailingButton = false,
  virtualized = true,
  sticky = true,
  onViewportBlur,
  onViewportFocus,
}: TestViewerProps) {
  const shellStyle: CSSProperties = { width, height };
  const { tree, bytes, status, error } = useStreamingNodes(value, { chunkSize });
  const ariaBusy = status === 'streaming' ? true : undefined;
  const statusText = status === 'error' ? (error?.message ?? 'error') : status;
  return (
    <div>
      <button type="button" data-testid="leading-button">
        before
      </button>
      <JsonViewer.Root value={tree} virtualized={virtualized} sticky={sticky}>
        <div className="tv-shell" style={shellStyle} data-testid="tv-shell">
          <JsonViewer.Viewport
            className="tv-viewport"
            aria-label="JSON tree"
            aria-busy={ariaBusy}
            data-testid="tv-viewport"
            onBlur={onViewportBlur}
            onFocus={onViewportFocus}
          >
            <JsonViewer.Content>
              {() => (
                <JsonViewer.Group className="tv-group">
                  {() => (
                    <JsonViewer.Line className="tv-line">
                      <JsonViewer.Trigger className="tv-trigger">
                        <Chevron />
                      </JsonViewer.Trigger>
                      <JsonViewer.LineContent />
                    </JsonViewer.Line>
                  )}
                </JsonViewer.Group>
              )}
            </JsonViewer.Content>
          </JsonViewer.Viewport>
          {showStatusBar && (
            <div className="tv-status-bar">
              <span>
                bytes <span data-testid="tv-bytes">{bytes.toLocaleString()}</span>
              </span>
              <span
                className="tv-status-chip"
                data-testid="tv-status"
                data-status={status}
              >
                {statusText}
              </span>
            </div>
          )}
        </div>
      </JsonViewer.Root>
      {withTrailingButton && (
        <button type="button" data-testid="trailing-button">
          after
        </button>
      )}
    </div>
  );
}
