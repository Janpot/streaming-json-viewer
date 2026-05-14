'use client';

import { useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Chevron } from '@/demo/chevron';
import './code-tabs.css';

type Props = {
  files: { name: string; html: string }[];
};

export function CodeTabs({ files }: Props) {
  const [expanded, setExpanded] = useState(false);
  const first = files[0]?.name ?? '';
  return (
    <div className="code-tabs">
      <button
        type="button"
        className="code-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={`code-toggle-icon ${expanded ? 'code-toggle-icon-open' : ''}`}>
          <Chevron />
        </span>
        <span>{expanded ? 'hide the code' : 'show the code'}</span>
      </button>
      {expanded && files.length > 0 && (
        <Tabs.Root defaultValue={first} className="code-panel">
          <Tabs.List className="code-tabs-bar">
            {files.map((file) => (
              <Tabs.Tab key={file.name} value={file.name} className="code-tab">
                {file.name}
              </Tabs.Tab>
            ))}
            <Tabs.Indicator className="code-tab-indicator" />
          </Tabs.List>
          <div className="code-block-stack">
            {files.map((file) => (
              <Tabs.Panel
                key={file.name}
                value={file.name}
                keepMounted
                className="code-block"
                dangerouslySetInnerHTML={{ __html: file.html }}
              />
            ))}
          </div>
        </Tabs.Root>
      )}
    </div>
  );
}
