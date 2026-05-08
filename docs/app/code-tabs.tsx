'use client';

import { useState } from 'react';
import './code-tabs.css';

type Tab = 'tsx' | 'css';

type Props = {
  tsxHtml: string;
  cssHtml: string;
};

export function CodeTabs({ tsxHtml, cssHtml }: Props) {
  const [tab, setTab] = useState<Tab>('tsx');
  const html = tab === 'tsx' ? tsxHtml : cssHtml;
  return (
    <div className="code-tabs">
      <div className="code-tabs-bar">
        <button
          className={`code-tab ${tab === 'tsx' ? 'code-tab-active' : ''}`}
          onClick={() => setTab('tsx')}
        >
          index.tsx
        </button>
        <button
          className={`code-tab ${tab === 'css' ? 'code-tab-active' : ''}`}
          onClick={() => setTab('css')}
        >
          index.css
        </button>
      </div>
      <div className="code-block" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
