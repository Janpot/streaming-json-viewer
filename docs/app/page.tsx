import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { codeToHtml, type BundledLanguage } from 'shiki';
import { CodeTabs } from './code-tabs';
import { DemoApp } from './demo-app';

const THEME = 'github-dark';

async function loadHighlighted(file: string, lang: BundledLanguage) {
  const source = await readFile(join(process.cwd(), 'app', file), 'utf8');
  const html = await codeToHtml(source, { lang, theme: THEME });
  return { name: file, html };
}

export default async function Page() {
  const files = await Promise.all([
    loadHighlighted('demo-viewer.tsx', 'tsx'),
    loadHighlighted('demo-viewer.css', 'css'),
    loadHighlighted('chevron.tsx', 'tsx'),
  ]);

  return (
    <div className="app">
      <div className="shell">
        <header className="header">
          <div>
            <h1 className="title">
              streaming <em>json</em> viewer
            </h1>
            <div className="tagline">streaming data · virtualized rendering · user styled</div>
          </div>
          <a
            className="gh-link"
            href="https://github.com/Janpot/streaming-json-viewer"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-1.93c-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17.91-.25 1.89-.38 2.86-.39.97.01 1.95.14 2.86.39 2.18-1.48 3.14-1.17 3.14-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.37-5.25 5.65.41.36.78 1.06.78 2.13v3.16c0 .31.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
            </svg>
          </a>
        </header>

        <p className="intro">
          A{' '}
          <a className="link" href="https://base-ui.com" target="_blank" rel="noreferrer">
            Base UI
          </a>
          -inspired React component for viewing JSON and JSON Lines data — handles millions of
          lines, parses incrementally as bytes arrive, and stays interactive throughout.
        </p>

        <CodeTabs files={files} />
        <DemoApp />
      </div>
    </div>
  );
}
