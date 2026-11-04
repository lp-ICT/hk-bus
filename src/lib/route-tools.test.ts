import { expect, test } from 'bun:test';
import { nearestRouteStop, headwayLabel, serviceDays } from './route-tools';
import type { Stop } from './bus';
const stops: Stop[] = [
  { id: 'bad', seq: 1, name: 'missing', lat: 0, lng: 0 },
  { id: 'bus', seq: 2, name: 'first', lat: 22.4, lng: 114.12 },
  { id: 'GMB:1', seq: 3, name: 'nearby minibus', lat: 22.37, lng: 114.12 },
];
test('nearest route stop ignores invalid coordinates and supports bus and minibus stops', () => {
  expect(nearestRouteStop(stops, null)).toBeNull();
  expect(nearestRouteStop(stops, { lat: 22.3701, lng: 114.12 })?.id).toBe('GMB:1');
  expect(nearestRouteStop(stops, { lat: 22.4001, lng: 114.12 })?.seq).toBe(2);
  expect(nearestRouteStop([stops[0]], { lat: 22.37, lng: 114.12 })).toBeNull();
});
test('service time bands keep weekdays, public holiday exceptions and frequency ranges', () => {
  const row = { weekdays: [true, true, true, true, true, false, false], public_holiday: false, start_time: '23:00:00', end_time: '01:00:00', frequency: 7, frequency_upper: 9 };
  expect(serviceDays(row)).toBe('星期一、二、三、四、五（公眾假期除外）');
  expect(headwayLabel(row)).toBe('每 7–9 分鐘一班');
  expect(headwayLabel({ ...row, frequency: null, end_time: null })).toContain('指定開出時間');
});
