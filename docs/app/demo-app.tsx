'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Tabs } from '@base-ui/react/tabs';
import { useStreamingNodes, type StreamValue } from 'streaming-json-viewer/streaming';
import { DemoViewer } from '@/demo';

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

const TABS = ['1.5mb', '15mb', 'jsonl', 'url', 'text'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  '1.5mb': '~1.5MB',
  '15mb': '~15MB',
  jsonl: 'json lines',
  url: 'url',
  text: 'text',
};

const SIZES: Record<'1.5mb' | '15mb', number> = {
  '1.5mb': 10000,
  '15mb': 100000,
};

const JSONL_COUNT = 10000;

const DEFAULT_TAB: Tab = '1.5mb';

function isTab(v: string | null): v is Tab {
  return TABS.includes(v as Tab);
}

function tabHref(tab: Tab): string {
  return tab === DEFAULT_TAB ? '/' : `/?tab=${tab}`;
}

export function DemoApp() {
  const searchParams = useSearchParams();
  const param = searchParams.get('tab');
  const activeTab: Tab = isTab(param) ? param : DEFAULT_TAB;

  const [urlValue, setUrlValue] = useState('');
  const [textValue, setTextValue] = useState(
    '{"hello":"world","nested":{"arr":[1,2,3,true,null]}}',
  );
  const [active, setActive] = useState<{ value: StreamValue; key: number } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const { tree, bytes, status, error } = useStreamingNodes(active?.value ?? null);
  const statusText = status === 'error' ? (error?.message ?? 'error') : status;

  useEffect(() => {
    setFetchError(null);
    if (activeTab === '1.5mb' || activeTab === '15mb') {
      setActive({ value: generateDemoJson(SIZES[activeTab]), key: Date.now() });
    } else if (activeTab === 'jsonl') {
      setActive({ value: generateDemoJsonl(JSONL_COUNT), key: Date.now() });
    }
    // 'url' and 'text' tabs wait for explicit user action.
  }, [activeTab]);

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

  return (
    <>
      <Tabs.Root value={activeTab}>
        <Tabs.List className="demo-actions">
          {TABS.map((t) => (
            <Tabs.Tab
              key={t}
              value={t}
              nativeButton={false}
              className="demo-action"
              render={<Link href={tabHref(t)} scroll={false} />}
            >
              {TAB_LABELS[t]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.Root>

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
      <DemoViewer value={tree} />
      <div className="status-bar">
        <span>
          <span className="status-bar-label">bytes</span>
          <span className="status-bar-value">{bytes.toLocaleString()}</span>
        </span>
        <span className="status-chip" data-status={status}>
          {statusText}
        </span>
      </div>
    </>
  );
}
