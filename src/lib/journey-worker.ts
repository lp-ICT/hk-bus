import { withJourneyTimes } from './journey-time';
import { planJourneys } from './journey';
self.onmessage = event => {
  try {
    const { routes, stops, rows, origin, destination, alightingIds, times } = event.data;
    self.postMessage({ journeys: planJourneys(routes, stops, rows, origin, destination, alightingIds).map(journey => withJourneyTimes(journey, times)) });
  } catch {
    self.postMessage({ error: '未能配對行程，請重試。' });
  }
};
