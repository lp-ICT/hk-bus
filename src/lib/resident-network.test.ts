import { expect, test } from 'bun:test';
import snapshot from '../../public/bus-data/resident-network.json';
import { residentRouteStops, type ResidentNetwork } from './resident-network';
import { arrivalsFor, favouriteKey, nearbyStops } from './bus';
import { directJourneys, planJourneys, journeyLegs } from './journey';
import { officialTimetableUrl } from './route-tools';
import { estimateJourney } from './journey-time';
import mtrSnapshot from '../../public/bus-data/mtr-network.json';

const network = snapshot as ResidentNetwork;
test('resident network includes both directions of 330 and 332, with official timetables and valid sequential stops', () => {
  for (const number of ['NR330', 'NR332']) for (const bound of ['1', '2']) {
    const route = network.routes.find(route => route.route === number && route.bound === bound)!;
    expect(route).toBeDefined();
    expect(officialTimetableUrl(route)).toStartWith('https://www.td.gov.hk/');
    const stops = residentRouteStops(network, route);
    expect(stops.length).toBeGreaterThan(1);
    expect(stops.every(stop => stop.lat > 22 && stop.lng > 113 && stop.etaAvailable === false)).toBe(true);
    expect(new Set(stops.map(stop => stop.seq)).size).toBe(stops.length);
    expect(stops[0].pickup).toBe(true);
    expect(stops.at(-1)!.dropoff).toBe(true);
  }
});
test('resident services can be found nearby and planned in the correct direction without inventing ETA', async () => {
  const route = network.routes.find(route => route.route === 'NR330' && route.bound === '1')!;
  const stops = residentRouteStops(network, route);
  expect(nearbyStops(network.stops, stops[0].lat, stops[0].lng).some(stop => stop.id === stops[0].id)).toBe(true);
  const journeys = directJourneys(network.routes, network.stops, network.rows, stops[0], stops.at(-1)!);
  const journey = journeys.find(journey => journey.route.service === route.service && journey.route.bound === route.bound)!;
  expect(journey).toBeDefined();
  expect(journey.stop.seq).toBeLessThan(journey.alight.seq);
  const arrivals = await arrivalsFor(route, stops[0]);
  expect(arrivals.every(arrival => arrival.eta === null)).toBe(true);
  expect(estimateJourney({ ...journey, arrivals, updated: Date.now(), error: false }, Date.now()).reason).toContain('居民巴士');
  expect(favouriteKey({ route, stop: stops[0] })).not.toBe(favouriteKey({ route: { ...route, bound: '2' }, stop: stops[0] }));
});
test('Park Island services connect to MTR at Tsing Yi in mixed transport planning', () => {
  const route = network.routes.find(route => route.route === 'NR330' && route.bound === '1')!;
  const origin = residentRouteStops(network, route)[0];
  const destination = mtrSnapshot.stops.find(stop => stop.id === 'MTR:DIS')!;
  const journeys = planJourneys([...network.routes, ...mtrSnapshot.routes] as ResidentNetwork['routes'], [...network.stops, ...mtrSnapshot.stops], [...network.rows, ...mtrSnapshot.rows] as ResidentNetwork['rows'], origin, destination);
  expect(journeys.some(journey => { const legs = journeyLegs(journey); return legs[0].route.route === 'NR330' && legs.some(leg => leg.route.company === 'MTR'); })).toBe(true);
});
