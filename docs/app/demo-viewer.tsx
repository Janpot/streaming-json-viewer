'use client';

import { JsonViewer, type StreamValue } from 'streaming-json-viewer';
import { Chevron } from './chevron';
import './demo-viewer.css';

type Props = {
  value: StreamValue | null;
};

export function DemoViewer({ value }: Props) {
  return (
    <JsonViewer.Root value={value}>
      <div className="viewer-shell">
        <JsonViewer.Viewport className="json-viewer">
          <JsonViewer.Body>
            {() => (
              <JsonViewer.Group className="group">
                {() => (
                  <JsonViewer.Line className="line">
                    <JsonViewer.Trigger className="trigger">
                      <Chevron />
                    </JsonViewer.Trigger>
                    <JsonViewer.LineContent />
                  </JsonViewer.Line>
                )}
              </JsonViewer.Group>
            )}
          </JsonViewer.Body>
        </JsonViewer.Viewport>
      </div>
      <div className="status-bar">
        <span className="status-bar-stat">
          <span className="status-bar-label">bytes</span>
          <JsonViewer.Bytes className="status-bar-value" />
        </span>
        <JsonViewer.Status className="status-chip" />
      </div>
    </JsonViewer.Root>
  );
}
