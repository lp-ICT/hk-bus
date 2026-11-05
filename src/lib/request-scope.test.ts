import { afterEach, expect, test } from 'bun:test';
import { arrivalsFor, type Route } from './bus';
import { requestScope } from './request-scope';
import snapshot from '../../public/bus-data/mtr-network.json';
import { mtrRouteStops, type MtrNetwork } from './mtr';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const route: Route = { company: 'KMB', route: '47X', bound: 'O', service: '1', from: '葵盛', to: '秦石' };
const stop = { id: 'CANCEL-TEST', name: '測試', lat: 22.3, lng: 114.1, seq: 1 };

test('suspending an ETA request aborts the connection without retrying or replacing saved data', async () => {
  let calls = 0;
  const controller = new AbortController();
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  }) as unknown as typeof fetch;
  const request = arrivalsFor(route, stop, undefined, controller.signal);
  controller.abort();
  await expect(request).rejects.toHaveProperty('name', 'AbortError');
  expect(calls).toBe(1);
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: [] }))) as unknown as typeof fetch;
  expect(await arrivalsFor(route, stop, undefined, new AbortController().signal)).toEqual([]);
});

test('a suspended screen cannot start bus, minibus or rail forecasts', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('Unexpected request'); }) as unknown as typeof fetch;
  for (const company of ['KMB', 'CTB', 'GMB', 'MTR'] as const) {
    await expect(arrivalsFor({ ...route, company }, stop, undefined, controller.signal)).rejects.toHaveProperty('name', 'AbortError');
  }
  expect(calls).toBe(0);
});

test('cancelling one screen does not cancel another active request scope', () => {
  const first = new AbortController();
  const second = new AbortController();
  const a = requestScope(first.signal, 10000);
  const b = requestScope(second.signal, 10000);
  first.abort();
  expect(a.signal.aborted).toBe(true);
  expect(b.signal.aborted).toBe(false);
  a.dispose(); b.dispose();
});

test('disposing a completed request removes its cancellation listener', () => {
  const controller = new AbortController();
  const scope = requestScope(controller.signal, 10000);
  scope.dispose();
  controller.abort();
  expect(scope.signal.aborted).toBe(false);
});

test('rail forecasts share requests within one screen and cancel independently across screens', async () => {
  const network = snapshot as MtrNetwork;
  const rail = network.routes.find(row => row.region === 'TWL')!;
  const station = mtrRouteStops(network, rail)[0];
  const first = new AbortController(), other = new AbortController();
  let schedules = 0;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('mtr-network.json')) return Promise.resolve(new Response(JSON.stringify(network)));
    schedules++;
    return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  }) as unknown as typeof fetch;
  const a = arrivalsFor(rail, station, undefined, first.signal);
  const b = arrivalsFor(rail, station, undefined, first.signal);
  const c = arrivalsFor(rail, station, undefined, other.signal);
  expect(schedules).toBe(2);
  const together = Promise.allSettled([a, b]);
  const separate = Promise.allSettled([c]);
  first.abort();
  const cancelled = await together;
  expect(cancelled.every(result => result.status === 'rejected' && result.reason.name === 'AbortError')).toBe(true);
  expect(other.signal.aborted).toBe(false);
  expect(schedules).toBe(2);
  other.abort();
  const remaining = await separate;
  expect(remaining[0].status).toBe('rejected');
});
