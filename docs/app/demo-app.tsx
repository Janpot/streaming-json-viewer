'use client';

import { useEffect, useState } from 'react';
import type { StreamValue } from 'streaming-json-viewer';
import { DemoViewer } from './demo-viewer';

const TAGS = ['urgent', 'review', 'draft', 'blocked', 'ready', 'shipped', 'archived'];

function makeItem(i: number) {
  return {
    id: i,
    sku: `SKU-${(i * 9301 + 49297) % 233280}`,
    name: `Item ${i}`,
    active: i % 7 !== 0,
    price: Math.round(Math.random() * 99999) / 100,
    tags: [TAGS[i % TAGS.length], TAGS[(i * 3) % TAGS.length]],
    meta: {
      createdAt: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString(),
      notes: i % 5 === 0 ? null : `Annotation for item ${i}, used for downstream analysis.`,
      score: i % 11 === 0 ? null : (i * 0.137) % 1,
      flags: { synced: i % 3 === 0, dirty: i % 13 === 0 },
    },
  };
}

function generateDemoJson(count: number): string {
  const items: unknown[] = [];
  for (let i = 0; i < count; i++) items.push(makeItem(i));
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    count,
    schema: { version: '1.4.0', fields: ['id', 'sku', 'name', 'active', 'price', 'tags', 'meta'] },
    items,
  });
}

function generateDemoJsonl(count: number): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) lines.push(JSON.stringify(makeItem(i)));
  return lines.join('\n');
}

type Tab = '1.5mb' | '15mb' | 'jsonl' | 'url' | 'text';

const SIZES: Record<'1.5mb' | '15mb', number> = {
  '1.5mb': 10000,
  '15mb': 100000,
};

const JSONL_COUNT = 10000;

function isTab(v: string | null): v is Tab {
  return v === '1.5mb' || v === '15mb' || v === 'jsonl' || v === 'url' || v === 'text';
}

export function DemoApp() {
  const [activeTab, setActiveTab] = useState<Tab>('1.5mb');
  const [urlValue, setUrlValue] = useState('');
  const [textValue, setTextValue] = useState(
    '{"hello":"world","nested":{"arr":[1,2,3,true,null]}}',
  );
  const [active, setActive] = useState<{ value: StreamValue; key: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadJson = async (count: number) => {
    setFetchError(null);
    setBusy(true);
    await new Promise((r) => setTimeout(r, 16));
    setActive({ value: generateDemoJson(count), key: Date.now() });
    setBusy(false);
  };

  const loadJsonl = async (count: number) => {
    setFetchError(null);
    setBusy(true);
    await new Promise((r) => setTimeout(r, 16));
    setActive({ value: generateDemoJsonl(count), key: Date.now() });
    setBusy(false);
  };

  const loadUrl = async () => {
    setFetchError(null);
    const url = urlValue.trim();
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('Response has no body');
      setActive({ value: res.body, key: Date.now() });
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadText = () => {
    if (!textValue.trim()) return;
    setActive({ value: textValue, key: Date.now() });
  };

  const runForTab = (tab: Tab) => {
    if (tab === '1.5mb' || tab === '15mb') void loadJson(SIZES[tab]);
    else if (tab === 'jsonl') void loadJsonl(JSONL_COUNT);
  };

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    const initial: Tab = isTab(tab) ? tab : '1.5mb';
    setActiveTab(initial);
    runForTab(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchTab = (next: Tab) => {
    setActiveTab(next);
    const url = new URL(window.location.href);
    if (next === '1.5mb') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
    runForTab(next);
  };

  return (
    <>
      <div className="demo-actions">
        <button
          className={`demo-action ${activeTab === '1.5mb' ? 'demo-action-active' : ''}`}
          onClick={() => switchTab('1.5mb')}
          disabled={busy}
        >
          ~1.5MB
        </button>
        <button
          className={`demo-action ${activeTab === '15mb' ? 'demo-action-active' : ''}`}
          onClick={() => switchTab('15mb')}
          disabled={busy}
        >
          15MB
        </button>
        <button
          className={`demo-action ${activeTab === 'jsonl' ? 'demo-action-active' : ''}`}
          onClick={() => switchTab('jsonl')}
          disabled={busy}
        >
          json lines
        </button>
        <button
          className={`demo-action ${activeTab === 'url' ? 'demo-action-active' : ''}`}
          onClick={() => switchTab('url')}
          disabled={busy}
        >
          url
        </button>
        <button
          className={`demo-action ${activeTab === 'text' ? 'demo-action-active' : ''}`}
          onClick={() => switchTab('text')}
          disabled={busy}
        >
          text
        </button>
      </div>

      {activeTab === 'url' && (
        <div className="demo-input-row">
          <input
            className="input"
            type="text"
            placeholder="https://example.com/data.json (must allow CORS)"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
          />
          <button className="run-btn" onClick={loadUrl}>
            fetch
          </button>
        </div>
      )}
      {activeTab === 'url' && fetchError && <div className="fetch-error">{fetchError}</div>}

      {activeTab === 'text' && (
        <div className="demo-input-row">
          <textarea
            className="textarea"
            placeholder="paste JSON here…"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
          />
          <button className="run-btn" onClick={loadText}>
            parse
          </button>
        </div>
      )}

      <div className="section-label">demo:</div>
      <DemoViewer value={active?.value ?? null} />
    </>
  );
}
