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
