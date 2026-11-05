import { expect, test } from 'bun:test';
import { matchRouteGeometry, type RouteFeature } from './route-geometry';
import type { Route, Stop } from './bus';

const route: Route = { company: 'KMB', route: '47X', bound: 'I', service: '1', from: '葵盛', to: '秦石' };
const stops: Stop[] = [1, 2, 3].map(seq => ({ id: String(seq), seq, name: String(seq), lat: 22.3 + seq * 0.01, lng: 114.1 }));
const feature = (points = stops, properties = { COMPANY_CODE: 'KMB', ROUTE_ID: 1233 }): RouteFeature => ({ properties, geometry: { type: 'LineString', coordinates: points.map(stop => [stop.lng, stop.lat]) } });

test('road geometry selects the matching direction and retains official vertices', () => {
  const result = matchRouteGeometry([feature([...stops].reverse()), feature()], route, stops);
  expect(result).toEqual([stops.map(stop => [stop.lat, stop.lng])]);
});
test('wrong operator, missing coordinates and inconsistent intermediate stops never draw a guessed line', () => {
  expect(matchRouteGeometry([feature(stops, { COMPANY_CODE: 'CTB', ROUTE_ID: 1233 })], route, stops)).toBeNull();
  expect(matchRouteGeometry([feature()], route, [stops[0], { ...stops[1], lng: 114.2 }, stops[2]])).toBeNull();
  expect(matchRouteGeometry([feature()], route, [])).toBeNull();
});
test('minibus matching uses official route ID rather than coinciding route numbers', () => {
  const minibus = { ...route, company: 'GMB' as const, service: '2004263' };
  expect(matchRouteGeometry([feature(stops, { COMPANY_CODE: 'GMB', ROUTE_ID: 2004263 })], minibus, stops)).not.toBeNull();
  expect(matchRouteGeometry([feature(stops, { COMPANY_CODE: 'GMB', ROUTE_ID: 9999 })], minibus, stops)).toBeNull();
});
test('invalid official coordinate systems are rejected', () => {
  const invalid = feature(); invalid.geometry.coordinates = [[830000, 820000], [830010, 820010]];
  expect(matchRouteGeometry([invalid], route, stops)).toBeNull();
});
