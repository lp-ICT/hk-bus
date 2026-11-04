import { afterEach, expect, test } from 'bun:test';
import { schoolSideStops, noArrivalMessage, distanceLabel, arrivalLabel, arrivalsFor, distance, nearbyArrivals, nearestRoutes, sortNearby, searchStops, routesAtStop, type Route } from './bus';
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

test('ETA shows only the first three predictions in sequence for both companies', async () => {
  const eta = new Date(Date.now() + 600000).toISOString();
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: [4, 3, 1, 2].map(eta_seq => ({ dir: 'O', seq: 3, service_type: 1, eta, eta_seq })) }))) as unknown as typeof fetch;
  for (const company of ['KMB', 'CTB'] as const) {
    const arrivals = await arrivalsFor({ ...route, company }, stop);
    expect(arrivals.map(arrival => arrival.seq)).toEqual([1, 2, 3]);
  }
});

test('station search matches places, normalizes spaces, keeps opposite stop IDs and ranks exact names first', () => {
  const stops = [{ ...stop, id: 'A', name: '田寮新村' }, { ...stop, id: 'B', name: '田寮新村' }, { ...stop, id: 'C', name: '田寮新村巴士總站' }, { ...stop, id: 'D', name: '旺角道' }];
  expect(searchStops(stops, ' 田寮 新村 ').map(s => s.id)).toEqual(['A', 'B', 'C']);
  expect(searchStops(stops, '旺角').map(s => s.id)).toEqual(['D']);
  expect(searchStops(stops, 'b').map(s => s.id)).toEqual(['B']);
  expect(searchStops(stops, '   ')).toEqual([]);
  expect(searchStops(stops, '不存在')).toEqual([]);
});
test('station routes retain direction, special service and repeated stop sequences', async () => {
  globalThis.fetch = (async (url: string | URL | Request) => new Response(JSON.stringify({ data: String(url).endsWith('/route-stop') ? [
    { stop: 'SEARCH-STOP', route: '1', bound: 'O', service_type: 1, seq: 3 },
    { stop: 'SEARCH-STOP', route: '1', bound: 'O', service_type: 1, seq: 18 },
    { stop: 'SEARCH-STOP', route: '1', bound: 'I', service_type: 2, seq: 4 },
    { stop: 'OTHER', route: '1', bound: 'O', service_type: 1, seq: 1 },
  ] : [{ stop: 'SEARCH-STOP', name_tc: '田寮新村', lat: '22.3', long: '114.1' }] }))) as unknown as typeof fetch;
  const special = { ...route, bound: 'I', service: '2' };
  const result = await routesAtStop('SEARCH-STOP', [route, special, { ...route, company: 'CTB' }]);
  expect(result.map(f => [f.route.company, f.route.bound, f.route.service, f.stop.seq])).toEqual([['KMB', 'O', '1', 3], ['KMB', 'O', '1', 18], ['KMB', 'I', '2', 4]]);
});

test('nearby routes sort by earliest ETA, keep missing predictions last and distance breaks ties', () => {
  const now = Date.now();
  const row = (minutes: number | null, meters: number) => ({ route, stop, meters, error: false, arrivals: minutes === null ? [] : [{ eta: new Date(now + minutes * 60000).toISOString(), seq: 1, remark: '' }] });
  const slow = row(10, 10), fast = row(2, 200), tie = row(2, 100), missing = row(null, 1), expired = row(-5, 2);
  expect(sortNearby([missing, slow, fast, expired, tie], now)).toEqual([tie, fast, slow, missing, expired]);
});
test('nearby stop ETA matches route, direction, service and sequence; failures are explicit', async () => {
  const eta = new Date(Date.now() + 300000).toISOString();
  globalThis.fetch = (async (url: string | URL | Request) => new Response(JSON.stringify({ data: String(url).includes('/stop-eta/') ? [
    { route: '1', dir: 'O', seq: 3, service_type: 1, eta, eta_seq: 1 },
    { route: '1', dir: 'I', seq: 3, service_type: 1, eta, eta_seq: 1 },
    { route: '1', dir: 'O', seq: 3, service_type: 2, eta, eta_seq: 1 },
    { route: '1', dir: 'O', seq: 18, service_type: 1, eta, eta_seq: 1 },
  ] : String(url).endsWith('/route-stop') ? [{ stop: 'NEAR-STOP', route: '1', bound: 'O', service_type: 1, seq: 3 }] : [{ stop: 'NEAR-STOP', name_tc: '測試站', lat: '22.3', long: '114.1' }] }))) as unknown as typeof fetch;
  const nearby = { ...stop, id: 'NEAR-STOP', meters: 100 };
  const result = await nearbyArrivals(nearby, [route]);
  expect(result[0].arrivals).toEqual([{ eta, seq: 1, remark: '' }]);
  const workingFetch = globalThis.fetch;
  globalThis.fetch = (async (url, options) => String(url).includes('/stop-eta/') ? new Response('', { status: 503 }) : workingFetch(url, options)) as typeof fetch;
  expect((await nearbyArrivals(nearby, [route]))[0].error).toBe(true);
});

test('nearby groups use nearest stop per direction, merge services without duplicate ETAs and cap at three', () => {
  const eta = (minute: number) => ({ eta: new Date(Date.now() + minute * 60000).toISOString(), seq: minute, remark: '' });
  const base = { route, stop, meters: 50, error: false, arrivals: [eta(2), eta(5)] };
  const result = nearestRoutes([ { ...base, meters: 200, stop: { ...stop, id: 'FAR' }, arrivals: [eta(1)] }, base,
    { ...base, route: { ...route, service: '2' }, arrivals: [base.arrivals[0], eta(8), eta(10)] },
    { ...base, route: { ...route, bound: 'I' } } ]);
  expect(result).toHaveLength(2);
  expect(result[0].stop.id).toBe(stop.id);
  expect(result[0].arrivals.map(a => a.seq)).toEqual([2, 5, 8]);
  expect(result[1].route.bound).toBe('I');
});

test('school entrance combines TW310 and TW311 and keeps the opposite stop separate', () => {
  const entranceA = { ...stop, id: '0A1DAEAFFDFF0B66' };
  const entranceB = { ...stop, id: '97BB9CE7A058E809' };
  const opposite = { ...stop, id: 'DEDD6247441C8C05' };
  const stops = [entranceA, opposite, entranceB, stop];
  expect(schoolSideStops(stops, 'entrance')).toEqual([entranceA, entranceB]);
  expect(schoolSideStops(stops, 'opposite')).toEqual([opposite]);
});
test('missing predictions do not imply that service has ended', () => {
  expect(noArrivalMessage([])).toBe('暫未有到站預報');
  expect(noArrivalMessage([{ eta: null, seq: 1, remark: '服務已結束' }])).toBe('服務已結束');
  expect(noArrivalMessage([{ eta: null, seq: 1, remark: '原定班次' }])).toBe('原定班次');
  expect(noArrivalMessage([{ eta: null, seq: 1, remark: '服務已結束' }, { eta: null, seq: 2, remark: '未有預報' }])).not.toBe('服務已結束');
});
test('distance clearly identifies approximate straight line metres and kilometres', () => {
  expect(distanceLabel(210.2)).toBe('距你約 210 米（直線）');
  expect(distanceLabel(1530)).toBe('距你約 1.5 公里（直線）');
});
test('route grouping retains explicit no-prediction remarks and marks partial service failures', () => {
  const base = { route, stop, meters: 20, error: false, arrivals: [{ eta: null, seq: 1, remark: '服務已結束' }] };
  expect(nearestRoutes([base])[0].arrivals[0].remark).toBe('服務已結束');
  const result = nearestRoutes([base, { ...base, route: { ...route, service: '2' }, error: true, arrivals: [] }]);
  expect(result[0].error).toBe(true);
});
