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

type Mode = 'demo' | 'url' | 'paste';

export default function Page() {
  const [mode, setMode] = useState<Mode>('demo');
  const [demoSize, setDemoSize] = useState(10000);
  const [urlValue, setUrlValue] = useState('');
  const [pasteValue, setPasteValue] = useState(
    '{"hello":"world","nested":{"arr":[1,2,3,true,null]}}',
  );
  const [active, setActive] = useState<{
    value: StreamValue;
    format: 'json' | 'jsonl';
    key: number;
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [urlFormat, setUrlFormat] = useState<'json' | 'jsonl'>('json');

  const run = async () => {
    setFetchError(null);
    if (mode === 'demo') {
      setGenerating(true);
      await new Promise((r) => setTimeout(r, 16));
      const json = generateDemoJson(demoSize);
      setGenerating(false);
      setActive({ value: json, format: 'json', key: Date.now() });
    } else if (mode === 'url') {
      const url = urlValue.trim();
      if (!url) return;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!res.body) throw new Error('Response has no body');
        setActive({ value: res.body, format: urlFormat, key: Date.now() });
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : String(e));
      }
    } else if (mode === 'paste') {
      if (!pasteValue.trim()) return;
      setActive({ value: pasteValue, format: 'json', key: Date.now() });
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
              className={`mode-btn ${mode === 'url' ? 'mode-btn-active' : ''}`}
              onClick={() => setMode('url')}
            >
              url
            </button>
            <button
              className={`mode-btn ${mode === 'paste' ? 'mode-btn-active' : ''}`}
              onClick={() => setMode('paste')}
            >
              paste
            </button>
          </div>

          {mode === 'demo' && (
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
                {generating ? 'generating…' : 'parse'}
              </button>
            </div>
          )}

          {mode === 'url' && (
            <div className="input-row">
              <input
                className="input"
                type="text"
                placeholder="https://example.com/data.json (must allow CORS)"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
              />
              <select
                className="select"
                value={urlFormat}
                onChange={(e) => setUrlFormat(e.target.value as 'json' | 'jsonl')}
              >
                <option value="json">json</option>
                <option value="jsonl">jsonl</option>
              </select>
              <button className="run-btn" onClick={run}>
                fetch
              </button>
            </div>
          )}
          {fetchError && mode === 'url' && (
            <div className="fetch-error">{fetchError}</div>
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
            <JsonViewer.Root value={active.value} format={active.format}>
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
              <JsonViewer.Viewport className="json-viewer" style={{ flex: 1 }}>
                <JsonViewer.Body>{() => <JsonViewer.Line className="row" />}</JsonViewer.Body>
              </JsonViewer.Viewport>
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
