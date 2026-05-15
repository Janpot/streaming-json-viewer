'use client';

import { useState } from 'react';
import { ScrollArea } from '@base-ui/react/scroll-area';
import { JsonViewer } from 'streaming-json-viewer';
import { useStreamingNodes } from 'streaming-json-viewer/streaming';
import { Chevron } from './chevron';
import { createDataStream } from './data';
import styles from './index.module.css';

export default function Demo() {
  const [stream] = useState(createDataStream);
  const { tree } = useStreamingNodes(stream);
  return (
    <JsonViewer.Root value={tree} virtualized>
      <ScrollArea.Root className={styles.scrollArea}>
        <ScrollArea.Viewport render={<JsonViewer.Viewport className={styles.viewport} />}>
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
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className={styles.scrollbar} orientation="vertical">
          <ScrollArea.Thumb className={styles.thumb} />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </JsonViewer.Root>
  );
}
