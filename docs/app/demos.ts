export const DEMO_NAMES = ['static', '15mb', 'jsonl', 'url', 'text', 'scrollarea'] as const;
export type DemoName = (typeof DEMO_NAMES)[number];

export const DEMO_LABELS: Record<DemoName, string> = {
  static: 'static JSON',
  '15mb': '~15MB',
  jsonl: 'json lines',
  url: 'url',
  text: 'text',
  scrollarea: 'custom scrollbars',
};

export const DEFAULT_DEMO: DemoName = 'static';
