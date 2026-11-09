import { expect, test } from 'bun:test';
import { startupTab } from './startup-tab';
const school = { lat: 22.383, lng: 114.137 };
const check = (time: string, position: typeof school | null = null) => startupTab(new Date(time + '+08:00'), position, school);
test('weekday morning window uses Hong Kong time and needs no GPS', () => {
  expect(check('2026-11-09T06:29:59')).toBe('nearby');
  expect(check('2026-11-09T06:30:00')).toBe('toSchool');
  expect(check('2026-11-09T09:00:00')).toBe('toSchool');
  expect(check('2026-11-09T09:01:00')).toBe('nearby');
  expect(check('2026-11-13T07:00:00')).toBe('toSchool');
  expect(check('2026-11-14T07:00:00')).toBe('nearby');
  expect(check('2026-11-15T07:00:00')).toBe('nearby');
});
test('weekday afternoon requires a device position within 300 metres', () => {
  expect(check('2026-11-09T15:44:59', school)).toBe('nearby');
  expect(check('2026-11-09T15:45:00', school)).toBe('school');
  expect(check('2026-11-09T19:00:00', school)).toBe('school');
  expect(check('2026-11-09T19:01:00', school)).toBe('nearby');
  expect(check('2026-11-09T16:00:00')).toBe('nearby');
  expect(check('2026-11-09T16:00:00', { lat: 22.39, lng: 114.137 })).toBe('nearby');
  expect(check('2026-11-09T16:00:00', { lat: 22.385, lng: 114.137 })).toBe('school');
  expect(check('2026-11-14T16:00:00', school)).toBe('nearby');
});
