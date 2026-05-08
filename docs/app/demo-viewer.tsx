'use client';

import { JsonViewer, type StreamValue } from 'streaming-json-viewer';
import { Chevron } from './chevron';
import './demo-viewer.css';

type Props = {
  value: StreamValue | null;
};

export function DemoViewer({ value }: Props) {
  return (
    <div className="viewer-shell">
      <JsonViewer.Root value={value}>
        <div className="meta">
          <div className="meta-group">
            <span className="stat">
              <span className="stat-label">bytes</span>
              <JsonViewer.Bytes className="stat-value" />
            </span>
            <span className="stat">
              <span className="stat-label">nodes</span>
              <JsonViewer.NodeCount className="stat-value" />
            </span>
            <span className="stat">
              <span className="stat-label">lines</span>
              <JsonViewer.LineCount className="stat-value" />
            </span>
          </div>
          <div className="meta-group">
            <JsonViewer.Status className="status" />
          </div>
        </div>
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
      </JsonViewer.Root>
    </div>
  );
}
