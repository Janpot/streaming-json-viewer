const TAGS = ['urgent', 'review', 'draft', 'blocked', 'ready', 'shipped', 'archived'];
const LINE_COUNT = 10_000;
const CHUNK_LINES = 256;

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

export function createDataStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      const end = Math.min(i + CHUNK_LINES, LINE_COUNT);
      let chunk = '';
      for (; i < end; i++) chunk += JSON.stringify(makeItem(i)) + '\n';
      controller.enqueue(encoder.encode(chunk));
      if (i >= LINE_COUNT) {
        controller.close();
        return;
      }
      await new Promise((r) => setTimeout(r, 0));
    },
  });
}
