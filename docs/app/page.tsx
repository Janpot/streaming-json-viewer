'use client';

import { useEffect, useState } from 'react';
import { JsonViewer } from 'streaming-json-viewer';
import type { StreamValue } from 'streaming-json-viewer';

function generateDemoJson(count: number): string {
  const tags = ['urgent', 'review', 'draft', 'blocked', 'ready', 'shipped', 'archived'];
  const items: unknown[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      id: i,
      sku: `SKU-${(i * 9301 + 49297) % 233280}`,
      name: `Item ${i}`,
      active: i % 7 !== 0,
      price: Math.round(Math.random() * 99999) / 100,
      tags: [tags[i % tags.length], tags[(i * 3) % tags.length]],
      meta: {
        createdAt: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString(),
        notes: i % 5 === 0 ? null : `Annotation for item ${i}, used for downstream analysis.`,
        score: i % 11 === 0 ? null : (i * 0.137) % 1,
        flags: { synced: i % 3 === 0, dirty: i % 13 === 0 },
      },
    });
  }
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    count,
    schema: { version: '1.4.0', fields: ['id', 'sku', 'name', 'active', 'price', 'tags', 'meta'] },
    items,
  });
}

function stringToStream(str: string, chunkSize = 65536): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let pos = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (pos >= str.length) {
        controller.close();
        return;
      }
      const slice = str.slice(pos, pos + chunkSize);
      pos += chunkSize;
      controller.enqueue(encoder.encode(slice));
      await new Promise((r) => setTimeout(r, 8));
    },
  });
}

type Mode = 'demo' | 'stream' | 'paste';

export default function Page() {
  const [mode, setMode] = useState<Mode>('demo');
  const [demoSize, setDemoSize] = useState(10000);
  const [pasteValue, setPasteValue] = useState(
    '{"hello":"world","nested":{"arr":[1,2,3,true,null]}}',
  );
  const [active, setActive] = useState<{ value: StreamValue; key: number } | null>(null);
  const [generating, setGenerating] = useState(false);

  const run = async () => {
    if (mode === 'demo') {
      setGenerating(true);
      await new Promise((r) => setTimeout(r, 16));
      const json = generateDemoJson(demoSize);
      setGenerating(false);
      setActive({ value: json, key: Date.now() });
    } else if (mode === 'stream') {
      setGenerating(true);
      await new Promise((r) => setTimeout(r, 16));
      const json = generateDemoJson(demoSize);
      setGenerating(false);
      setActive({ value: stringToStream(json), key: Date.now() });
    } else if (mode === 'paste') {
      if (!pasteValue.trim()) return;
      setActive({ value: pasteValue, key: Date.now() });
    }
  };

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <div className="shell">
        <header className="header">
          <div>
            <h1 className="title">
              streaming <em>json</em> viewer
            </h1>
            <div className="tagline">incremental parse · lazy line lookup · sticky ancestors</div>
          </div>
        </header>

        <div className="controls">
          <div className="mode-row">
            <button
              className={`mode-btn ${mode === 'demo' ? 'mode-btn-active' : ''}`}
              onClick={() => setMode('demo')}
            >
              demo
            </button>
            <button
              className={`mode-btn ${mode === 'stream' ? 'mode-btn-active' : ''}`}
              onClick={() => setMode('stream')}
            >
              stream
            </button>
            <button
              className={`mode-btn ${mode === 'paste' ? 'mode-btn-active' : ''}`}
              onClick={() => setMode('paste')}
            >
              paste
            </button>
          </div>

          {(mode === 'demo' || mode === 'stream') && (
            <div className="input-row">
              <select
                className="select"
                value={demoSize}
                onChange={(e) => setDemoSize(parseInt(e.target.value))}
              >
                <option value={1000}>1,000 items (~145 KB)</option>
                <option value={10000}>10,000 items (~1.5 MB)</option>
                <option value={50000}>50,000 items (~7.5 MB)</option>
                <option value={100000}>100,000 items (~15 MB)</option>
              </select>
              <button className="run-btn" onClick={run} disabled={generating}>
                {generating ? 'generating…' : mode === 'stream' ? 'stream' : 'parse'}
              </button>
            </div>
          )}

          {mode === 'paste' && (
            <div className="input-row">
              <textarea
                className="textarea"
                placeholder="paste JSON here…"
                value={pasteValue}
                onChange={(e) => setPasteValue(e.target.value)}
              />
              <button className="run-btn" onClick={run}>
                parse
              </button>
            </div>
          )}
        </div>

        {active && (
          <div className="viewer-shell" key={active.key}>
            <JsonViewer.Root value={active.value}>
              <JsonViewer.StatusBar />
              <JsonViewer.Viewport style={{ flex: 1 }} />
            </JsonViewer.Root>
          </div>
        )}

        <div className="arch">
          <div className="arch-title">{'// virtualization model'}</div>
          each node caches <code>subtreeLines</code>. total = <code>root.subtreeLines</code> (O(1)).
          <br />
          line N lookup descends the tree using cached counts; subsequent lines via O(1){' '}
          <code>nextLine</code>.
          <br />
          collapse just toggles a flag and bubbles the delta up the parent chain.
          <br />
          <br />
          <div className="arch-title">{'// sticky behavior'}</div>
          the same descent that finds the topmost row also produces the <code>path</code> of
          ancestors above it — that&apos;s the sticky chain. click a sticky to collapse and re-pin
          it.
        </div>
      </div>
    </div>
  );
}
