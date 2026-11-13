import { withJourneyTimes } from './journey-time';
import { directJourneys, planJourneys } from './journey';
self.onmessage = event => {
  try {
    const { routes, stops, rows, origin, destination, alightingIds, times, preferredRoutes } = event.data;
    self.postMessage({ partial: true, journeys: directJourneys(routes, stops, rows, origin, destination, false, alightingIds).map(journey => withJourneyTimes(journey, times)) });
    self.postMessage({ journeys: planJourneys(routes, stops, rows, origin, destination, alightingIds, preferredRoutes).map(journey => withJourneyTimes(journey, times)) });
  } catch {
    self.postMessage({ error: '未能配對行程，請重試。' });
  }
};
