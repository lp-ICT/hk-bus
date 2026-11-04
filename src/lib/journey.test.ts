import { expect, test } from 'bun:test';
import { directJourneys, transferJourneys, planJourneys, hkPlace, schoolPlace, schoolDestinationStops, type RouteStop } from './journey';
import type { Route, Stop } from './bus';
import { sortJourneys } from '../pages/journey-planner';

const route: Route = { company: 'KMB', route: '40X', bound: 'O', service: '1', from: '起點', to: '終點' };
const start = { name: '起點位置', lat: 22.35, lng: 114.1 };
const end = { name: '目的地位置', lat: 22.38, lng: 114.13 };
const stops: Stop[] = [
  { id: 'A', name: '上車站', lat: start.lat, lng: start.lng, seq: 0 },
  { id: 'B', name: '中途站', lat: 22.36, lng: 114.12, seq: 0 },
  { id: 'C', name: '落車站', lat: end.lat, lng: end.lng, seq: 0 },
];
const rows: RouteStop[] = stops.map((stop, i) => ({ route: route.route, bound: 'O', service_type: 1, stop: stop.id, seq: i + 1 }));

test('direct journeys retain correct direction and boarding/alighting sequence', () => {
  const reverse = { ...route, bound: 'I' };
  const reversedRows = [...rows].reverse().map((row, i) => ({ ...row, bound: 'I', seq: i + 1 }));
  const result = directJourneys([route, reverse], stops, [...rows, ...reversedRows], start, end);
  expect(result).toHaveLength(1);
  expect(result[0].stop.id).toBe('A');
  expect(result[0].alight.id).toBe('C');
  expect(result[0].route.bound).toBe('O');
});

test('no match is returned for reversed travel, same stop, or out of range origins', () => {
  expect(directJourneys([route], stops, rows, end, start)).toEqual([]);
  expect(directJourneys([route], stops, rows, start, start)).toEqual([]);
  expect(directJourneys([route], stops, rows, { ...start, lat: 22.2 }, end)).toEqual([]);
});

test('school routes work without GPS and prioritize routes reachable from current location', () => {
  const remote = { ...route, route: '99' };
  const remoteStop = { ...stops[0], id: 'D', lat: 22.2 };
  const result = directJourneys([route, remote], [...stops, remoteStop], [...rows, { ...rows[0], route: '99', stop: 'D' }, { ...rows[2], route: '99' }], start, end, true);
  expect(result.map(journey => journey.route.route)).toEqual(['40X', '99']);
  expect(result.map(journey => journey.nearby)).toEqual([true, false]);
  const noGps = directJourneys([route], stops, rows, null, end, true);
  expect(noGps).toHaveLength(1);
  expect(noGps[0].nearby).toBe(false);
  expect(noGps[0].stop.id).toBe('A');
});

test('special services do not cross-match with main service and nearest boarding stop wins', () => {
  const special = { ...route, service: '2' };
  const nearStop = { ...stops[0], id: 'NEAR', lat: start.lat + 0.0001 };
  const farther = { ...stops[0], lat: start.lat + 0.003 };
  const mixed = [...rows, { ...rows[0], service_type: 2, stop: 'NEAR' }];
  expect(directJourneys([route, special], [farther, stops[1], stops[2], nearStop], mixed, start, end)[0].route.service).toBe('1');
  const result = directJourneys([route, special], [farther, stops[1], stops[2], nearStop], [...mixed, { ...rows[2], service_type: 2 }], start, end);
  expect(result).toHaveLength(1);
  expect(result[0].stop.id).toBe('NEAR');
  expect(result[0].route.service).toBe('2');
});

test('loop routes only allow a later occurrence of the destination', () => {
  const looping = [{ ...rows[2], seq: 1 }, { ...rows[0], seq: 2 }, { ...rows[2], seq: 5 }];
  const result = directJourneys([route], stops, looping, start, end);
  expect(result[0].stop.seq).toBe(2);
  expect(result[0].alight.seq).toBe(5);
});

test('arrival ranking prioritizes nearby school routes then earliest ETA and puts missing forecasts last', () => {
  const now = Date.now();
  const journey = directJourneys([route], stops, rows, start, end)[0];
  const make = (minutes: number | null, nearby = true) => ({ ...journey, nearby, arrivals: minutes === null ? [] : [{ eta: new Date(now + minutes * 60000).toISOString(), remark: '', seq: 1 }], updated: now, error: false });
  const fast = make(2), slow = make(8), remote = make(1, false), missing = make(null);
  expect(sortJourneys([remote, missing, slow, fast], now)).toEqual([fast, slow, missing, remote]);
});

test('official HK80 school coordinates convert to the school area in WGS84', () => {
  expect(schoolPlace.lat).toBeGreaterThan(22.38);
  expect(schoolPlace.lat).toBeLessThan(22.382);
  expect(schoolPlace.lng).toBeGreaterThan(114.131);
  expect(schoolPlace.lng).toBeCloseTo(114.134817, 5);
  const schoolEntrance = { ...stops[0], lat: 22.380443, lng: 114.135135 };
  expect(Math.abs(schoolPlace.lat - schoolEntrance.lat)).toBeLessThan(0.001);
  expect(Math.abs(schoolPlace.lng - schoolEntrance.lng)).toBeLessThan(0.001);
});

test('school alighting is restricted to confirmed stops rather than nearby tunnel interchanges', () => {
  const tunnel = { ...stops[2], id: 'TUNNEL', name: '城門隧道轉車站' };
  const tunnelRows = [{ ...rows[0], route: '88' }, { ...rows[2], route: '88', stop: 'TUNNEL' }];
  const result = directJourneys([route, { ...route, route: '88' }], [...stops, tunnel], [...rows, ...tunnelRows], start, end, true, ['C']);
  expect(result.map(journey => journey.route.route)).toEqual(['40X']);
  expect(directJourneys([{ ...route, route: '88' }], [...stops, tunnel], tunnelRows, start, end)).toEqual([]);
});

test('transfers preserve direction and separate bus and minibus routes with identical numbers', () => {
  const second: Route = { ...route, company: 'GMB', bound: '1', service: '200', region: 'NT' };
  const interchange = { ...stops[1], id: 'GMB:T', lat: stops[1].lat + 0.0001 };
  const finish = { ...stops[2], id: 'GMB:END' };
  const network = [...stops, interchange, finish];
  const links: RouteStop[] = [rows[0], rows[1],
    { company: 'GMB', route: second.route, bound: '1', service_type: '200', stop: interchange.id, seq: 1 },
    { company: 'GMB', route: second.route, bound: '1', service_type: '200', stop: finish.id, seq: 2 }];
  expect(directJourneys([route, second], network, links, start, end)).toHaveLength(0);
  const result = transferJourneys([route, second], network, links, start, end);
  expect(result).toHaveLength(1);
  expect(result[0].route.company).toBe('KMB');
  expect(result[0].alight.id).toBe('B');
  expect(result[0].transfer?.leg.route.company).toBe('GMB');
  expect(result[0].transfer?.leg.stop.id).toBe('GMB:T');
  expect(result[0].transfer?.leg.alight.id).toBe('GMB:END');
  expect(transferJourneys([route, second], network, links.map(row => ({ ...row, dropoff: row.stop !== 'B' })), start, end)).toHaveLength(0);
  expect(transferJourneys([route, second], network, links.map(row => ({ ...row, pickup: row.stop !== 'GMB:T' })), start, end)).toHaveLength(0);
  expect(transferJourneys([route, second], network, links, end, start)).toHaveLength(0);
  expect(transferJourneys([route, second], network.map(stop => stop.id === 'GMB:T' ? { ...stop, lat: stop.lat + 0.004 } : stop), links, start, end)).toHaveLength(0);
});

test('journey matching never boards at drop-off-only stops or alights at pick-up-only stops', () => {
  expect(directJourneys([route], stops, rows.map(row => ({ ...row, pickup: row.stop !== 'A' })), start, end)).toHaveLength(0);
  expect(directJourneys([route], stops, rows.map(row => ({ ...row, dropoff: row.stop !== 'C' })), start, end)).toHaveLength(0);
});

test('school destinations include local minibuses but exclude tunnel and distant minibus stops', () => {
  const local = { id: 'GMB:SCHOOL', name: '學校附近小巴站', lat: schoolPlace.lat, lng: schoolPlace.lng, seq: 0 };
  const distant = { ...local, id: 'GMB:FAR', lat: schoolPlace.lat + 0.01 };
  const tunnel = { ...local, id: 'TUNNEL', name: '城門隧道轉車站' };
  expect(schoolDestinationStops([local, distant, tunnel])).toEqual(['GMB:SCHOOL']);
});

test('two transfers include walking links and preserve all three legs and stop restrictions', () => {
  const points: Stop[] = Array.from({ length: 6 }, (_, i) => ({ id: 'P' + i, name: '站' + i, lat: 22.30 + Math.floor((i + 1) / 2) * 0.02, lng: 114.1 + (i % 2 ? 0.0001 : 0), seq: 0 }));
  const services = ['A', 'B', 'C'].map(value => ({ ...route, route: value }));
  const links = points.map((stop, i) => ({ route: services[Math.floor(i / 2)].route, bound: 'O', service_type: '1', stop: stop.id, seq: i % 2 + 1 }));
  const origin = { ...points[0] }, destination = { ...points[5] };
  const result = transferJourneys(services, points, links, origin, destination);
  expect(result).toHaveLength(1);
  expect(result[0].route.route).toBe('A');
  expect(result[0].transfer?.leg.route.route).toBe('B');
  expect(result[0].transfer?.leg.transfer?.leg.route.route).toBe('C');
  expect(result[0].transfer!.meters).toBeGreaterThan(0);
  expect(transferJourneys(services, points, links.map(row => ({ ...row, pickup: row.stop !== 'P2' })), origin, destination)).toHaveLength(0);
  expect(transferJourneys(services, points, links, destination, origin)).toHaveLength(0);
  expect(transferJourneys(services, points.map(stop => stop.id === 'P2' ? { ...stop, lat: stop.lat + 0.004 } : stop), links, origin, destination)).toHaveLength(0);
});

test('three transfers exceed the supported journey limit', () => {
  const points: Stop[] = Array.from({ length: 8 }, (_, i) => ({ id: 'Q' + i, name: '站' + i, lat: 22.30 + Math.floor((i + 1) / 2) * 0.02, lng: 114.1, seq: 0 }));
  const services = ['A', 'B', 'C', 'D'].map(value => ({ ...route, route: value }));
  const links = points.map((stop, i) => ({ route: services[Math.floor(i / 2)].route, bound: 'O', service_type: '1', stop: stop.id, seq: i % 2 + 1 }));
  expect(transferJourneys(services, points, links, points[0], points[7])).toHaveLength(0);
});


test('school journey planning does not let remote direct routes hide reachable transfer journeys', () => {
  const second = { ...route, route: 'SECOND' };
  const remote = { ...route, route: 'REMOTE' };
  const far = { ...stops[0], id: 'FAR', lat: 22.2 };
  const network = [...stops, far];
  const links = [rows[0], rows[1], { ...rows[1], route: second.route, seq: 1 }, { ...rows[2], route: second.route, seq: 2 }, { ...rows[0], route: remote.route, stop: far.id }, { ...rows[2], route: remote.route }];
  const result = planJourneys([route, second, remote], network, links, start, end, ['C']);
  expect(result).toHaveLength(1);
  expect(result[0].route.route).toBe('40X');
  expect(result[0].transfer?.leg.route.route).toBe('SECOND');
});
