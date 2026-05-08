'use client';

import { useState } from 'react';
import { Chevron } from './chevron';
import './code-tabs.css';

type Props = {
  files: { name: string; html: string }[];
};

export function CodeTabs({ files }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [activeName, setActiveName] = useState(files[0]?.name ?? '');
  const active = files.find((f) => f.name === activeName) ?? files[0];
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
      {expanded && active && (
        <>
          <div className="code-tabs-bar">
            {files.map((file) => (
              <button
                key={file.name}
                className={`code-tab ${file.name === active.name ? 'code-tab-active' : ''}`}
                onClick={() => setActiveName(file.name)}
              >
                {file.name}
              </button>
            ))}
          </div>
          <div className="code-block" dangerouslySetInnerHTML={{ __html: active.html }} />
        </>
      )}
    </div>
  );
}
