'use client';

import { useState } from 'react';
import { JsonViewer } from 'streaming-json-viewer';
import { Chevron } from './chevron';
import data from './data.json';
import styles from './index.module.css';

export default function Demo() {
  const [sticky, setSticky] = useState(false);
  return (
    <JsonViewer.Root value={data} sticky={sticky}>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={sticky}
          onChange={(e) => setSticky(e.target.checked)}
        />
        sticky headers
      </label>
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
