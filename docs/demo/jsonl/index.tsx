'use client';

import { useState } from 'react';
import { JsonViewer } from 'streaming-json-viewer';
import { useStreamingNodes } from 'streaming-json-viewer/streaming';
import { Chevron } from './chevron';
import { createDataStream } from './data';
import styles from './index.module.css';

export default function Demo() {
  const [stream] = useState(createDataStream);
  const { tree } = useStreamingNodes(stream);
  return (
    <JsonViewer.Root value={tree} virtualized sticky>
      <JsonViewer.Viewport className={styles.viewport}>
        <JsonViewer.Content>
          {() => (
            <JsonViewer.Group>
              {() => (
                <JsonViewer.Line className={styles.line}>
                  <JsonViewer.Trigger className={styles.trigger}>
                    <Chevron />
                  </JsonViewer.Trigger>
                  <JsonViewer.LineContent />
                </JsonViewer.Line>
              )}
            </JsonViewer.Group>
          )}
        </JsonViewer.Content>
      </JsonViewer.Viewport>
    </JsonViewer.Root>
  );
}
