import { JsonViewer, type StreamValue } from 'streaming-json-viewer';
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
  onViewportBlur,
  onViewportFocus,
}: TestViewerProps) {
  const shellStyle: CSSProperties = { width, height };
  return (
    <div>
      <button type="button" data-testid="leading-button">
        before
      </button>
      <JsonViewer.Root value={value} chunkSize={chunkSize}>
        <div className="tv-shell" style={shellStyle} data-testid="tv-shell">
          <JsonViewer.Viewport
            className="tv-viewport"
            aria-label="JSON tree"
            data-testid="tv-viewport"
            onBlur={onViewportBlur}
            onFocus={onViewportFocus}
          >
            <JsonViewer.Body>
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
            </JsonViewer.Body>
          </JsonViewer.Viewport>
          {showStatusBar && (
            <div className="tv-status-bar">
              <span>
                bytes <JsonViewer.Bytes data-testid="tv-bytes" />
              </span>
              <JsonViewer.StatusLabel className="tv-status-chip" data-testid="tv-status" />
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
