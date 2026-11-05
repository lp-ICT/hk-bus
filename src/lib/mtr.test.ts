import { expect, test } from 'bun:test';
import snapshot from '../../public/bus-data/mtr-network.json';
import { parseMtrArrivals, mtrRouteStops, mtrEntries, transferWalk, type MtrNetwork, type TrainResponse } from './mtr';
import { nearbyStops, type Route } from './bus';
import { directJourneys, planJourneys, journeyLegs } from './journey';
import { estimateJourney, withJourneyTimes } from './journey-time';

const network = snapshot as MtrNetwork;
const station = (code: string) => network.stops.find(stop => stop.id === 'MTR:' + code)!;
const route = (line: string, bound: string, branch?: string) => network.routes.find(route => route.region === line && route.bound === bound && (!branch || route.service === branch))!;
const now = Date.parse('2026-11-05T10:00:00+08:00');
const train = (dest: string, minute: number, seq = 1, valid = 'Y') => ({ dest, seq: String(seq), valid, plat: '2', time: '2026-11-05 10:' + String(minute).padStart(2, '0') + ':00' });
const response = (line: string, code: string, bound: string, trains: ReturnType<typeof train>[]): TrainResponse => ({ status: 1, isdelay: 'N', data: { [line + '-' + code]: { curr_time: '2026-11-05 10:00:00', [bound]: trains } } });

test('official MTR snapshot retains all ten lines, station positions, branch paths and real directions', () => {
  expect(new Set(network.routes.map(route => route.region)).size).toBe(10);
  expect(network.stops.length).toBe(97);
  expect(network.stops.every(stop => stop.lat > 22 && stop.lat < 23 && stop.lng > 113 && stop.lng < 115)).toBe(true);
  expect(mtrRouteStops(network, route('TWL', 'DOWN')).map(stop => stop.id)).toContain('MTR:TSW');
  expect(mtrRouteStops(network, route('EAL', 'UP', 'EAL:LMC-UT')).at(-1)?.id).toBe('MTR:LMC');
  expect(mtrEntries(network, 'MTR:TSW', network.routes).map(entry => entry.route.bound)).toEqual(['DOWN']);
});

test('MTR forecasts parse Hong Kong dates, cap three, exclude invalid trains and preserve platform and destination', () => {
  const value = response('TWL', 'TSW', 'DOWN', [train('CEN', 2), train('CEN', 4, 2, 'N'), train('CEN', 6, 3), train('CEN', 8, 4), train('CEN', 10, 5)]);
  const arrivals = parseMtrArrivals(value, route('TWL', 'DOWN'), station('TSW'), network, station('ADM'), now);
  expect(arrivals).toHaveLength(3);
  expect(Date.parse(arrivals[0].eta!)).toBe(now + 120000);
  expect(arrivals[0].remark).toContain('2 號月台');
  expect(arrivals[0].destinationStopId).toBe('MTR:CEN');
});

test('short turns and opposite branches cannot supply a forecast beyond their terminus', () => {
  const value = response('EAL', 'ADM', 'UP', [train('SHT', 3), train('LMC', 5, 2), train('LOW', 7, 3)]);
  const toLow = route('EAL', 'UP', 'EAL:UT');
  expect(parseMtrArrivals(value, toLow, station('ADM'), network, station('LOW'), now).map(row => row.destinationStopId)).toEqual(['MTR:LOW']);
  expect(parseMtrArrivals(value, toLow, station('ADM'), network, station('TAW'), now).map(row => row.destinationStopId)).toEqual(['MTR:SHT', 'MTR:LOW']);
});

test('MTR failures and stale data stay errors, while no trains is not labelled service ended', () => {
  expect(() => parseMtrArrivals({ status: 0, message: 'Unavailable' }, route('TWL', 'DOWN'), station('TSW'), network, undefined, now)).toThrow();
  expect(() => parseMtrArrivals({ status: 1, data: {} }, route('TWL', 'DOWN'), station('TSW'), network, undefined, now)).toThrow();
  const value = response('TWL', 'TSW', 'DOWN', []);
  expect(parseMtrArrivals(value, route('TWL', 'DOWN'), station('TSW'), network, undefined, now)).toEqual([]);
  expect(() => parseMtrArrivals(value, route('TWL', 'DOWN'), station('TSW'), network, undefined, now + 120000)).toThrow('過時');
});

test('nearby MTR uses the existing 300 metre limit and station directions can be saved separately', () => {
  const at = station('TSW');
  expect(nearbyStops(network.stops, at.lat, at.lng).map(stop => stop.id)).toContain(at.id);
  expect(nearbyStops(network.stops, at.lat + 0.01, at.lng).map(stop => stop.id)).not.toContain(at.id);
  const entries = mtrEntries(network, 'MTR:LAK', network.routes);
  expect(new Set(entries.map(entry => entry.route.region))).toEqual(new Set(['TCL', 'TWL']));
});

test('rail interchange walking allows known connected stations without relaxing ordinary bus links', () => {
  const a = station('CEN'), b = station('HOK');
  expect(transferWalk(a, b, 450)).toBe(500);
  expect(transferWalk({ ...a, id: 'busA' }, { ...b, id: 'busB' }, 300)).toBeNull();
  expect(transferWalk(a, { ...b, id: 'busB' }, 350)).toBe(350);
  expect(transferWalk(a, { ...b, id: 'busB' }, 401)).toBeNull();
});

test('real MTR topology finds Ocean Park with one change and Disneyland with two changes', () => {
  for (const [code, lines] of [['OCP', ['荃灣綫', '南港島綫']], ['DIS', ['荃灣綫', '東涌綫', '迪士尼綫']]] as const) {
    const results = planJourneys(network.routes, network.stops, network.rows, station('TSW'), station(code));
    expect(results.some(journey => journeyLegs(journey).map(leg => leg.route.route).join('/') === lines.join('/'))).toBe(true);
    expect(results.every(journey => journeyLegs(journey).length <= 3)).toBe(true);
    expect(results.every(journey => journeyLegs(journey).every(leg => leg.stop.seq < leg.alight.seq))).toBe(true);
  }
});

test('airport express is not offered for unrestricted city-to-city trips', () => {
  const results = directJourneys(network.routes.filter(route => route.region === 'AEL'), network.stops, network.rows, station('TSY'), station('HOK'));
  expect(results).toEqual([]);
  const airport = directJourneys(network.routes.filter(route => route.region === 'AEL'), network.stops, network.rows, station('TSY'), station('AIR'));
  expect(airport.length).toBeGreaterThan(0);
});

test('MTR arrival estimates include station access time and never invent a future connecting departure', () => {
  const j = directJourneys(network.routes, network.stops, network.rows, station('ADM'), station('OCP'))[0];
  const timed = withJourneyTimes(j);
  expect(timed.rideMinutes).toBeGreaterThan(0);
  const arrivals = [{ eta: new Date(now + 120000).toISOString(), remark: '', seq: 1 }, { eta: new Date(now + 300000).toISOString(), remark: '', seq: 2 }];
  const estimate = estimateJourney({ ...timed, arrivals, updated: now, error: false }, now);
  expect(estimate.legs[0].boarding).toBe(now + 300000);
  expect(estimate.arrival).toBeGreaterThan(now + 300000);
  expect(estimateJourney({ ...timed, arrivals: arrivals.slice(0, 1), updated: now, error: false }, now).arrival).toBeUndefined();
});

test('dense bus candidates cannot crowd a valid pure rail transfer out of the result limit', () => {
  const bus = (id: string): Route => ({ company: 'KMB', route: id, bound: 'O', service: '1', from: '起點', to: '終點' });
  const buses = Array.from({ length: 20 }, (_, i) => bus('TEST' + i));
  const origin = { ...station('TSW'), id: 'test-origin' };
  const hub = { ...station('ADM'), id: 'test-hub' };
  const exit = { ...station('OCP'), id: 'test-exit' };
  const rows = buses.flatMap(route => [origin, hub, exit].map((stop, i) => ({ company: 'KMB' as const, route: route.route, bound: 'O', service_type: '1', stop: stop.id, seq: i + 1 })));
  const results = planJourneys([...buses, ...network.routes], [...network.stops, origin, hub, exit], [...network.rows, ...rows], station('TSW'), station('OCP'));
  expect(results.some(journey => journey.transfer && journeyLegs(journey).every(leg => leg.route.company === 'MTR'))).toBe(true);
  expect(results.filter(journey => journeyLegs(journey).length === 2).length).toBeLessThanOrEqual(12);
});

test('school feeder plus two rail lines survives dense bus and single-line mixed candidates', () => {
  const origin = { id: 'school', name: '學校', lat: station('TSW').lat + 0.015, lng: station('TSW').lng, seq: 0 };
  const feeder: Route = { company: 'KMB', route: 'FEED', bound: 'O', service: '1', from: '學校', to: '荃灣' };
  const buses = Array.from({ length: 20 }, (_, i): Route => ({ ...feeder, route: 'BUS' + i }));
  const feederRows = [origin, station('TSW')].map((stop, i) => ({ company: 'KMB' as const, route: feeder.route, bound: 'O', service_type: '1', stop: stop.id, seq: i + 1 }));
  const crowded = buses.flatMap(bus => [origin, station('ADM'), station('OCP')].map((stop, i) => ({ company: 'KMB' as const, route: bus.route, bound: 'O', service_type: '1', stop: stop.id, seq: i + 1 })));
  const result = planJourneys([...buses, feeder, ...network.routes], [origin, ...network.stops], [...crowded, ...feederRows, ...network.rows], origin, station('OCP'));
  expect(result.some(j => journeyLegs(j).map(leg => leg.route.route).join('/') === 'FEED/荃灣綫/南港島綫')).toBe(true);
  expect(result.filter(j => journeyLegs(j).length === 3).length).toBeLessThanOrEqual(12);
  expect(result.every(j => journeyLegs(j).length <= 3)).toBe(true);
});

test('identified park can use its nearby rail station without widening other destination limits', () => {
  const destination = { name: '香港迪士尼樂園', lat: station('DIS').lat - 0.004, lng: station('DIS').lng, railStationId: 'MTR:DIS' };
  const results = planJourneys(network.routes, network.stops, network.rows, station('TSW'), destination);
  expect(results.some(j => journeyLegs(j).at(-1)?.alight.id === 'MTR:DIS')).toBe(true);
  expect(planJourneys(network.routes, network.stops, network.rows, station('TSW'), { ...destination, railStationId: undefined })).toHaveLength(0);
});
