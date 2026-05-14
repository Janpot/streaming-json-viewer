'use client';

import { JsonViewer } from 'streaming-json-viewer';
import { Chevron } from './chevron';
import './index.css';

export interface DemoViewerProps {
  value: unknown;
}

export function DemoViewer({ value }: DemoViewerProps) {
  return (
    <JsonViewer.Root value={value}>
      <JsonViewer.Viewport className="viewport">
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
  );
}
