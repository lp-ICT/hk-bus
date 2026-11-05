import { expect, test } from 'bun:test';
import { estimateJourney, withJourneyTimes, estimateClock, type TimedJourney } from './journey-time';
import { sortJourneys } from '../pages/journey-planner';
import type { Journey } from './journey';

const now = Date.parse('2026-11-05T08:00:00+08:00');
const eta = (minutes: number) => ({ eta: new Date(now + minutes * 60000).toISOString(), remark: '', seq: 1 });
const base: Journey = { route: { company: 'KMB', route: '1', bound: 'O', service: '1', from: '起點', to: '終點' }, stop: { id: 'A', name: '上車', lat: 22.3, lng: 114.1, seq: 1 }, alight: { id: 'B', name: '落車', lat: 22.4, lng: 114.2, seq: 3 }, meters: 0, endMeters: 0, nearby: true, rideMinutes: 10 };
const timed = (journey: Journey = base, arrivals = [eta(5)]): TimedJourney => ({ ...journey, arrivals, updated: now, error: false });

test('arrival ranking uses destination arrival rather than the first bus ETA', () => {
  const earlySlow = timed({ ...base, rideMinutes: 40 }, [eta(1)]);
  const laterFast = timed({ ...base, rideMinutes: 5 }, [eta(6)]);
  expect(sortJourneys([earlySlow, laterFast], now)).toEqual([laterFast, earlySlow]);
  expect(estimateJourney(laterFast, now).arrival).toBe(now + 11 * 60000);
});

test('walking time skips a bus that departs before the passenger can reach the stop', () => {
  const result = estimateJourney(timed({ ...base, meters: 150, endMeters: 75 }, [eta(1), eta(5)]), now);
  expect(result.legs[0].boarding).toBe(now + 5 * 60000);
  expect(result.arrival).toBeCloseTo(now + 16.3 * 60000, 0);
  expect(result.walking).toBeCloseTo(3.9);
});

test('transfer arrival includes previous ride, walking, buffer and a catchable second forecast', () => {
  const next = { ...base, route: { ...base.route, route: '2' }, rideMinutes: 4 };
  const row = timed({ ...base, transfer: { leg: next, meters: 75 } });
  row.legArrivals = [[eta(5)], [eta(16), eta(20)]];
  const result = estimateJourney(row, now);
  expect(result.legs[1].boarding).toBe(now + 20 * 60000);
  expect(result.arrival).toBe(now + 24 * 60000);
});

test('two transfers preserve every leg and never use a forecast before reaching that stop', () => {
  const last = { ...base, route: { ...base.route, route: '3' }, rideMinutes: 3 };
  const middle = { ...base, route: { ...base.route, route: '2' }, rideMinutes: 4, transfer: { leg: last, meters: 0 } };
  const row = timed({ ...base, transfer: { leg: middle, meters: 0 } });
  row.legArrivals = [[eta(5)], [eta(10), eta(17)], [eta(20), eta(23)]];
  expect(estimateJourney(row, now).arrival).toBe(now + 26 * 60000);
  expect(estimateJourney(row, now).legs).toHaveLength(3);
});

test('missing future connecting forecasts produce no invented arrival', () => {
  const row = timed({ ...base, transfer: { leg: base, meters: 0 } });
  row.legArrivals = [[eta(5)], [eta(2), eta(10)]];
  expect(estimateJourney(row, now).arrival).toBeUndefined();
  expect(estimateJourney(row, now).reason).toContain('第2程');
});

test('stale, failed, originless and unmatched journeys cannot appear to have current arrival estimates', () => {
  for (const row of [timed({ ...base, meters: Infinity }), timed({ ...base, rideMinutes: undefined }), { ...timed(), error: true }, { ...timed(), updated: now - 91000 }]) {
    expect(estimateJourney(row, now).arrival).toBeUndefined();
    expect(sortJourneys([row, timed()], now)[0]).not.toBe(row);
  }
});

test('reference times are bound to route, direction, service and interpolate supplemental sequences', () => {
  const times = { version: 1, snapshot_at: new Date(now).toISOString(), routes: { 'KMB-1-O-1': [[1, 0], [2, 5], [3, 20]] as [number, number][] } };
  expect(withJourneyTimes(base, times).rideMinutes).toBe(20);
  expect(withJourneyTimes({ ...base, alight: { ...base.alight, seq: 2.5 } }, times).rideMinutes).toBe(12.5);
  expect(withJourneyTimes({ ...base, route: { ...base.route, bound: 'I' } }, times).rideMinutes).toBeUndefined();
  expect(withJourneyTimes({ ...base, route: { ...base.route, service: '2' } }, times).rideMinutes).toBeUndefined();
});

test('clock display uses Hong Kong time including day rollover', () => {
  expect(estimateClock(Date.parse('2026-11-05T16:05:00Z'))).toBe('00:05');
});


test('school favourites pin matching direction and boarding stop while retaining arrival ranking', () => {
  const fast = timed({ ...base, route: { ...base.route, route: '2' }, rideMinutes: 1 });
  const savedSlow = timed({ ...base, rideMinutes: 30 });
  const savedFast = timed({ ...base, rideMinutes: 10 });
  expect(sortJourneys([fast, savedSlow, savedFast], now, [base])).toEqual([savedFast, savedSlow, fast]);
  expect(sortJourneys([fast, savedSlow], now, [{ ...base, route: { ...base.route, bound: 'I' } }])).toEqual([fast, savedSlow]);
  expect(sortJourneys([fast, savedSlow], now, [{ ...base, stop: { ...base.stop, id: 'elsewhere' } }])).toEqual([fast, savedSlow]);
});

test('a saved connecting leg pins the whole journey without changing general search defaults', () => {
  const direct = timed({ ...base, rideMinutes: 1 });
  const connection = { ...base, route: { ...base.route, route: '3' } };
  const transfer = timed({ ...base, transfer: { leg: connection, meters: 0 } });
  transfer.legArrivals = [[eta(5)], [eta(20)]];
  expect(sortJourneys([direct, transfer], now, [connection])[0]).toBe(transfer);
  expect(sortJourneys([direct, transfer], now)[0]).toBe(direct);
});
