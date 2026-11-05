import { expect, test } from 'bun:test';
import { googleTransitUrl } from './google-directions';
import { schoolPlace } from './journey';

test('school directions carry selected coordinates and public transport mode', () => {
  const url = new URL(googleTransitUrl(schoolPlace, { name: '海洋公園', lat: 22.249, lng: 114.174 })!);
  expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
  expect(url.searchParams.get('api')).toBe('1');
  expect(url.searchParams.get('travelmode')).toBe('transit');
  expect(url.searchParams.get('origin')).toBe(schoolPlace.lat + ',' + schoolPlace.lng);
  expect(url.searchParams.get('destination')).toBe('22.249,114.174');
});
test('GPS unavailable leaves Google to request the origin rather than inventing a position', () => {
  const url = new URL(googleTransitUrl(null, schoolPlace)!);
  expect(url.searchParams.has('origin')).toBe(false);
  expect(url.searchParams.get('destination')).toBe(schoolPlace.lat + ',' + schoolPlace.lng);
});
test('unresolved place names remain usable with Hong Kong context and are safely encoded', () => {
  const url = new URL(googleTransitUrl('荃灣站', '海洋公園 & 水上樂園')!);
  expect(url.searchParams.get('origin')).toBe('荃灣站, 香港');
  expect(url.searchParams.get('destination')).toBe('海洋公園 & 水上樂園, 香港');
  expect(url.searchParams.size).toBe(4);
});
test('empty destinations and invalid coordinates cannot produce misleading directions', () => {
  expect(googleTransitUrl(null, '  ')).toBeUndefined();
  expect(googleTransitUrl(schoolPlace, { name: '壞資料', lat: NaN, lng: 114 })).toBeUndefined();
  expect(googleTransitUrl({ ...schoolPlace, lat: 999 }, '海洋公園')).toBeUndefined();
});
