import type { Place } from './journey';

type Endpoint = Place | string | null;
function endpoint(value: Endpoint) {
  if (!value) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? text + (/香港|hong kong/i.test(text) ? '' : ', 香港') : '';
  }
  return Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180
    ? value.lat + ',' + value.lng : '';
}
export function googleTransitUrl(origin: Endpoint, destination: Endpoint): string | undefined {
  const end = endpoint(destination);
  if (!end) return undefined;
  const params = new URLSearchParams({ api: '1', destination: end, travelmode: 'transit' });
  const start = endpoint(origin);
  if (origin && !start) return undefined;
  if (start) params.set('origin', start);
  return 'https://www.google.com/maps/dir/?' + params.toString();
}
