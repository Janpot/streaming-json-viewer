'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Tabs } from '@base-ui/react/tabs';
import { CodeTabs } from './code-tabs';
import type { CodeFile } from './page';
import { DEMO_NAMES, DEMO_LABELS, DEFAULT_DEMO, type DemoName } from './demos';
import DemoStatic from '@/demo/static';
import Demo15MbBig from '@/demo/15mb';
import DemoJsonl from '@/demo/jsonl';
import DemoUrl from '@/demo/url';
import DemoText from '@/demo/text';
import DemoScrollArea from '@/demo/scrollarea';

const DEMO_COMPONENTS: Record<DemoName, () => React.JSX.Element> = {
  static: DemoStatic,
  '15mb': Demo15MbBig,
  jsonl: DemoJsonl,
  url: DemoUrl,
  text: DemoText,
  scrollarea: DemoScrollArea,
};

function isDemoName(v: string | null): v is DemoName {
  return DEMO_NAMES.includes(v as DemoName);
}

function tabHref(tab: DemoName): string {
  return tab === DEFAULT_DEMO ? '/' : `/?tab=${tab}`;
}

export function DemoApp({ fileMap }: { fileMap: Record<DemoName, CodeFile[]> }) {
  const searchParams = useSearchParams();
  const param = searchParams.get('tab');
  const activeTab: DemoName = isDemoName(param) ? param : DEFAULT_DEMO;
  const ActiveDemo = DEMO_COMPONENTS[activeTab];

  return (
    <>
      <Tabs.Root value={activeTab}>
        <Tabs.List className="demo-actions">
          {DEMO_NAMES.map((t) => (
            <Tabs.Tab
              key={t}
              value={t}
              nativeButton={false}
              className="demo-action"
              render={<Link href={tabHref(t)} scroll={false} />}
            >
              {DEMO_LABELS[t]}
            </Tabs.Tab>
          ))}
          <Tabs.Indicator className="demo-action-indicator" />
        </Tabs.List>
      </Tabs.Root>

      <div className="section-label">demo:</div>
      <ActiveDemo key={`demo:${activeTab}`} />
      <CodeTabs key={`code:${activeTab}`} files={fileMap[activeTab]} />
    </>
  );
}
