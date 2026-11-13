import { expect, test } from 'bun:test';

test('worker delivers direct journeys before completing transfer search', async () => {
  const worker = new Worker(new URL('./journey-worker.ts', import.meta.url).href);
  try {
    const messages = await new Promise<any[]>((resolve, reject) => {
      const received: any[] = [];
      const timer = setTimeout(() => reject(new Error('Worker did not finish')), 5000);
      worker.onmessage = event => {
        received.push(event.data);
        if (!event.data.partial) { clearTimeout(timer); resolve(received); }
      };
      worker.onerror = event => { clearTimeout(timer); reject(event); };
      worker.postMessage({
        routes: [{ company: 'KMB', route: '46P', bound: 'O', service: '1', from: '美田', to: '葵芳' }],
        stops: [{ id: 'A', name: '美田巴士總站', lat: 22.37, lng: 114.17, seq: 0 }, { id: 'B', name: '學校', lat: 22.38, lng: 114.16, seq: 0 }],
        rows: [{ route: '46P', bound: 'O', service_type: '1', stop: 'A', seq: 1 }, { route: '46P', bound: 'O', service_type: '1', stop: 'B', seq: 2 }],
        origin: { name: '美田', lat: 22.37, lng: 114.17 }, destination: { name: '學校', lat: 22.38, lng: 114.16 }, alightingIds: ['B'],
      });
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].partial).toBe(true);
    expect(messages[0].journeys[0].route.route).toBe('46P');
    expect(messages[1].partial).toBeUndefined();
    expect(messages[1].journeys[0].stop.id).toBe('A');
  } finally { worker.terminate(); }
});
