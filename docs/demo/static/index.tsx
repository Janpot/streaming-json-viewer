'use client';

import { JsonViewer } from 'streaming-json-viewer';
import { Chevron } from './chevron';
import data from './data.json';
import styles from './index.module.css';

export default function Demo() {
  return (
    <JsonViewer.Root value={data}>
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
