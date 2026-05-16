'use client';

import { useState } from 'react';
import { JsonViewer } from 'streaming-json-viewer';
import { useStreamingNodes } from 'streaming-json-viewer/streaming';
import { Chevron } from './chevron';
import styles from './index.module.css';

const SAMPLE = '{"hello":"world","nested":{"arr":[1,2,3,true,null]}}';

export default function Demo() {
  const [text, setText] = useState(SAMPLE);
  const [source, setSource] = useState<string>(SAMPLE);
  const { tree } = useStreamingNodes(source);

  return (
    <>
      <div className={styles.inputRow}>
        <textarea
          className={styles.textarea}
          placeholder="paste JSON here…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className={styles.button} onClick={() => setSource(text)}>
          parse
        </button>
      </div>
      <JsonViewer.Root value={tree} sticky>
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
    </>
  );
}
