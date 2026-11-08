import { expect, test } from 'bun:test';
import { estimateJourney, withJourneyTimes, estimateClock, type TimedJourney } from './journey-time';
import { withoutRedundantTransfers, canCollapseTransfers, matchesSavedJourney, sortJourneys } from '../pages/journey-planner';
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


test('destination arrival precedes school favourites', () => {
  const fast = timed({ ...base, route: { ...base.route, route: '2' }, rideMinutes: 1 });
  const savedSlow = timed({ ...base, rideMinutes: 30 });
  const savedFast = timed({ ...base, rideMinutes: 10 });
  expect(sortJourneys([fast, savedSlow, savedFast], now, [base])).toEqual([fast, savedFast, savedSlow]);
  expect(sortJourneys([fast, savedSlow], now, [{ ...base, route: { ...base.route, bound: 'I' } }])).toEqual([fast, savedSlow]);
  expect(sortJourneys([fast, savedSlow], now, [{ ...base, stop: { ...base.stop, id: 'elsewhere' } }])).toEqual([fast, savedSlow]);
});

test('saved transfers stay behind direct journeys in general destination search', () => {
  const direct = timed({ ...base, rideMinutes: 1 });
  const connection = { ...base, route: { ...base.route, route: '3' } };
  const transfer = timed({ ...base, transfer: { leg: connection, meters: 0 } });
  transfer.legArrivals = [[eta(5)], [eta(20)]];
  expect(sortJourneys([direct, transfer], now, [connection])[0]).toBe(direct);
  expect(sortJourneys([direct, transfer], now)[0]).toBe(direct);
});

test('to-school matches favourites across stops without overriding faster arrivals', () => {
  const fast = timed({ ...base, route: { ...base.route, route: '2' }, rideMinutes: 1 });
  const slowSaved = timed({ ...base, rideMinutes: 30 });
  const fastSaved = timed({ ...base, rideMinutes: 10 });
  const saved = { ...base, stop: { ...base.stop, id: 'another-stop', seq: 8 } };
  expect(sortJourneys([fast, slowSaved, fastSaved], now, [saved], true)).toEqual([fast, fastSaved, slowSaved]);
  for (const route of [{ ...base.route, bound: 'I' }, { ...base.route, company: 'GMB' as const }, { ...base.route, route: '3' }]) {
    expect(sortJourneys([fast, slowSaved], now, [{ ...saved, route }], true)).toEqual([fast, slowSaved]);
  }
  expect(sortJourneys([fast, slowSaved], now, [saved])).toEqual([fast, slowSaved]);
});

test('to-school keeps a saved connecting route behind direct services', () => {
  const direct = timed({ ...base, rideMinutes: 1 });
  const connection = { ...base, route: { ...base.route, route: '3' } };
  const transfer = timed({ ...base, transfer: { leg: connection, meters: 0 } });
  transfer.legArrivals = [[eta(5)], [eta(20)]];
  const saved = { ...connection, stop: { ...connection.stop, id: 'other', seq: 5 } };
  expect(sortJourneys([direct, transfer], now, [saved], true)[0]).toBe(direct);
});

test('to-school keeps minibus route IDs separate when numbers and directions coincide', () => {
  const minibus = { ...base, route: { ...base.route, company: 'GMB' as const, route: '1', bound: '1', service: '1001' } };
  const savedSlow = timed({ ...minibus, rideMinutes: 30 });
  const fast = timed({ ...base, rideMinutes: 1 });
  const saved = { ...minibus, stop: { ...base.stop, id: 'other' } };
  expect(sortJourneys([fast, savedSlow], now, [saved], true)[0]).toBe(fast);
  expect(sortJourneys([fast, savedSlow], now, [{ ...saved, route: { ...saved.route, service: '2001' } }], true)[0]).toBe(fast);
});

test('school saved marker and ordering agree across stop, service, and normalized route fields', () => {
  const saved = { ...base, route: { ...base.route, route: ' 1 ', bound: 'o' }, stop: { ...base.stop, id: 'OTHER', seq: 10 } };
  const slow = timed({ ...base, route: { ...base.route, service: '2' }, rideMinutes: 40 });
  const fast = timed({ ...base, route: { ...base.route, route: '2' }, rideMinutes: 1 });
  expect(matchesSavedJourney(slow, [saved], true)).toBe(true);
  expect(sortJourneys([fast, slow], now, [saved], true)[0]).toBe(fast);
  expect(matchesSavedJourney(slow, [saved])).toBe(false);
  expect(matchesSavedJourney({ ...slow, route: { ...slow.route, bound: 'I' } }, [saved], true)).toBe(false);
});

test('direct and transfer options share destination arrival ranking', () => {
  const fast = timed({ ...base, route: { ...base.route, route: '2' }, rideMinutes: 1 });
  const saved = timed({ ...base, rideMinutes: 30 });
  const connection = { ...base, route: { ...base.route, route: '3' }, rideMinutes: 1 };
  const transfer = timed({ ...fast, transfer: { leg: connection, meters: 0 } });
  transfer.legArrivals = [[eta(5)], [eta(20)]];
  const savedTransfer = { ...transfer, route: base.route };
  expect(sortJourneys([transfer, fast, savedTransfer, saved], now, [base], true)).toEqual([fast, savedTransfer, transfer, saved]);
  expect(sortJourneys([transfer, saved, fast], now)).toEqual([fast, transfer, saved]);
  const unknown = { ...fast, arrivals: [], legArrivals: [], rideMinutes: undefined };
  expect(sortJourneys([transfer, unknown], now)).toEqual([transfer, unknown]);
});


test('favourites win equal destination arrivals but never override a faster transfer', () => {
  const direct = timed({ ...base, rideMinutes: 30 });
  const connection = { ...base, route: { ...base.route, route: '3' }, rideMinutes: 1 };
  const transfer = timed({ ...base, route: { ...base.route, route: '2' }, rideMinutes: 1, transfer: { leg: connection, meters: 0 } });
  transfer.legArrivals = [[eta(5)], [eta(10)]];
  expect(sortJourneys([direct, transfer], now, [base], true)).toEqual([transfer, direct]);
  const equal = timed({ ...base, route: { ...base.route, route: '4' } });
  expect(sortJourneys([equal, timed()], now, [base])).toEqual([timed(), equal]);
});

test('rail station destinations put direct buses before second-leg rail and other transfers', () => {
  const railLeg: Journey = { ...base, route: { ...base.route, company: 'MTR' } };
  const direct = timed({ ...base, rideMinutes: 60 });
  const railTransfer = timed({ ...base, transfer: { leg: railLeg, meters: 0 } });
  const busTransfer = timed({ ...base, transfer: { leg: base, meters: 0 } });
  expect(sortJourneys([busTransfer, railTransfer, direct], now, [], false, 'destination')).toEqual([direct, railTransfer, busTransfer]);
});

test('two rail endpoints prioritise entirely rail journeys including line changes', () => {
  const railLeg: Journey = { ...base, route: { ...base.route, company: 'MTR' } };
  const rail = timed({ ...railLeg, transfer: { leg: railLeg, meters: 0 } });
  const mixed = timed({ ...base, transfer: { leg: railLeg, meters: 0 } });
  const bus = timed();
  expect(sortJourneys([bus, mixed, rail], now, [], false, 'both')[0]).toBe(rail);
});

test('arrival ordering remains active inside each rail priority group', () => {
  const slow = timed({ ...base, rideMinutes: 60 });
  const fast = timed({ ...base, rideMinutes: 5 });
  expect(sortJourneys([slow, fast], now, [], false, 'destination')).toEqual([fast, slow]);
});

test('collapse transfers only with two distinct direct routes, not duplicate boarding stops', () => {
  const transfer: Journey = { ...base, transfer: { leg: base, meters: 0 } };
  const second: Journey = { ...base, route: { ...base.route, route: '2' } };
  expect(canCollapseTransfers([base, second, transfer])).toBe(true);
  expect(canCollapseTransfers([base, { ...base, stop: { ...base.stop, id: 'other' } }, transfer])).toBe(false);
  expect(canCollapseTransfers([base, transfer])).toBe(false);
  expect(canCollapseTransfers([transfer])).toBe(false);
  expect(canCollapseTransfers([base, second])).toBe(false);
});


test('hide transfers containing any direct service in the same direction, including third legs', () => {
  const direct = { ...base, route: { ...base.route, company: 'GMB' as const, route: '312', service: 'official-312' } };
  const feeder = { ...base, route: { ...base.route, route: '140M' }, transfer: { leg: { ...direct, stop: { ...direct.stop, id: 'other' } }, meters: 0 } };
  const third = { ...base, route: { ...base.route, route: '40' }, transfer: { leg: feeder, meters: 0 } };
  const reverse = { ...feeder, transfer: { leg: { ...direct, route: { ...direct.route, bound: 'I' } }, meters: 0 } };
  const otherOperator = { ...feeder, transfer: { leg: { ...direct, route: { ...direct.route, company: 'KMB' as const } }, meters: 0 } };
  const otherService = { ...feeder, transfer: { leg: { ...direct, route: { ...direct.route, service: 'other-region-312' } }, meters: 0 } };
  expect(withoutRedundantTransfers([feeder, direct, third, reverse, otherOperator, otherService])).toEqual([direct, reverse, otherOperator, otherService]);
  expect(withoutRedundantTransfers([feeder, third])).toEqual([feeder, third]);
  expect(withoutRedundantTransfers([{ ...direct, transfer: { leg: base, meters: 0 } }, direct])).toEqual([direct]);
});
