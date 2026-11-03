import { afterEach, expect, test } from 'bun:test';
import { arrivalLabel, arrivalsFor, distance, type Route } from './bus';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const route: Route = { company: 'KMB', route: '1', bound: 'O', service: '1', from: '竹園邨', to: '尖沙咀碼頭' };
const stop = { id: 'STOP', seq: 3, name: '測試站', lat: 22.3, lng: 114.1 };
test('ETA excludes opposite directions, repeated stop sequences, different service types and expired predictions', async () => {
  const future = new Date(Date.now() + 300000).toISOString();
  const row = { dir: 'O', seq: 3, service_type: 1, eta: future, eta_seq: 1, rmk_tc: '原定班次' };
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: [row, { ...row, dir: 'I' }, { ...row, seq: 18 }, { ...row, service_type: 2 }, { ...row, eta: new Date(Date.now() - 120000).toISOString() }] }))) as unknown as typeof fetch;
  expect(await arrivalsFor(route, stop)).toEqual([{ eta: future, remark: '原定班次', seq: 1 }]);
});
test('Citybus keeps stop sequence and direction without requiring KMB service type', async () => {
  const eta = new Date(Date.now() + 600000).toISOString();
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ dir: 'I', seq: 3, eta, eta_seq: 1 }, { dir: 'O', seq: 3, eta, eta_seq: 1 }] }))) as unknown as typeof fetch;
  expect(await arrivalsFor({ ...route, company: 'CTB', bound: 'I' }, stop)).toEqual([{ eta, seq: 1, remark: '' }]);
});
test('network failure is not presented as no buses', async () => {
  globalThis.fetch = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
  expect(arrivalsFor(route, stop)).rejects.toThrow();
});
test('countdown handles missing, imminent and future predictions', () => {
  const now = Date.parse('2026-11-03T10:00:00+08:00');
  expect(arrivalLabel(null, now)).toBe('未有預報');
  expect(arrivalLabel('invalid', now)).toBe('未有預報');
  expect(arrivalLabel('2026-11-03T10:00:30+08:00', now)).toBe('即將到站');
  expect(arrivalLabel('2026-11-03T10:05:00+08:00', now)).toBe('5 分鐘');
});
test('nearby distances use metres', () => {
  expect(distance(stop.lat, stop.lng, stop)).toBe(0);
  expect(distance(stop.lat + 0.01, stop.lng, stop)).toBeGreaterThan(1100);
  expect(distance(stop.lat + 0.01, stop.lng, stop)).toBeLessThan(1120);
});
