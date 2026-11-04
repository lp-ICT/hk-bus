import { planJourneys } from './journey';
self.onmessage = event => {
  try {
    const { routes, stops, rows, origin, destination, alightingIds } = event.data;
    self.postMessage({ journeys: planJourneys(routes, stops, rows, origin, destination, alightingIds) });
  } catch {
    self.postMessage({ error: '未能配對行程，請重試。' });
  }
};
