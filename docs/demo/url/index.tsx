'use client';

import { useState } from 'react';
import { JsonViewer } from 'streaming-json-viewer';
import { useStreamingNodes, type StreamValue } from 'streaming-json-viewer/streaming';
import { Chevron } from './chevron';
import styles from './index.module.css';

export default function Demo() {
  const [url, setUrl] = useState('');
  const [stream, setStream] = useState<StreamValue | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const { tree } = useStreamingNodes(stream);

  const load = async () => {
    setFetchError(null);
    const trimmed = url.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(trimmed);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('Response has no body');
      setStream(res.body);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          type="text"
          placeholder="https://example.com/data.json (must allow CORS)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button className={styles.button} onClick={load}>
          fetch
        </button>
      </div>
      {fetchError && <div className={styles.error}>{fetchError}</div>}
      <JsonViewer.Root value={tree} virtualized>
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
