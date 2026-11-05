import { distance, type Route, type Stop } from './bus';

export type RouteFeature = { properties: Record<string, string | number>; geometry: { type: string; coordinates: number[][] | number[][][] } };
export type RouteLine = [number, number][];

export function matchRouteGeometry(features: RouteFeature[], route: Route, stops: Stop[]): RouteLine[] | null {
  if (stops.length < 2 || stops.some(stop => !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng))) return null;
  let best: { lines: RouteLine[]; score: number } | null = null;
  for (const feature of features) {
    const p = feature.properties;
    if (route.company === 'GMB' ? String(p.ROUTE_ID) !== route.service : !String(p.COMPANY_CODE).split('+').some(code => route.company === 'KMB' ? code === 'KMB' || code === 'LWB' : code === route.company)) continue;
    const raw = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates as number[][]] : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates as number[][][] : [];
    if (!raw.length || raw.some(line => line.length < 2 || line.some(point => !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < 113 || point[0] > 115 || point[1] < 21 || point[1] > 24))) continue;
    const lines: RouteLine[] = raw.map(line => line.map(point => [point[1], point[0]]));
    const points = lines.flat();
    const first = points[0], last = points[points.length - 1];
    const ends = distance(first[0], first[1], stops[0]) + distance(last[0], last[1], stops[stops.length - 1]);
    if (distance(first[0], first[1], stops[0]) > 180 || distance(last[0], last[1], stops[stops.length - 1]) > 180) continue;
    let lengthSoFar = 0;
    const segments = lines.flatMap(line => line.slice(1).map((b, i) => {
      const a = line[i], length = distance(a[0], a[1], { lat: b[0], lng: b[1] });
      const segment = { a, b, start: lengthSoFar, length };
      lengthSoFar += length;
      return segment;
    }));
    let states: { at: number; score: number }[] = [{ at: 0, score: ends }];
    for (let index = 0; index < stops.length; index++) {
      const stop = stops[index];
      const scale = Math.cos(stop.lat * Math.PI / 180);
      const candidates = segments.flatMap(({ a, b, start, length }) => {
        const ax = (a[1] - stop.lng) * scale * 111195, ay = (a[0] - stop.lat) * 111195;
        const dx = (b[1] - a[1]) * scale * 111195, dy = (b[0] - a[0]) * 111195;
        const denominator = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (denominator || 1)));
        const at = start + t * length, meters = Math.hypot(ax + t * dx, ay + t * dy);
        if (meters > 180 || index === 0 && at > 180 || index === stops.length - 1 && at < lengthSoFar - 180) return [];
        return [{ at, score: meters * meters }];
      }).sort((a, b) => a.at - b.at);
      let previousIndex = 0, bestPrevious = Infinity;
      const next: typeof states = [];
      for (const candidate of candidates) {
        while (previousIndex < states.length && states[previousIndex].at <= candidate.at + 30) {
          bestPrevious = Math.min(bestPrevious, states[previousIndex++].score);
        }
        if (Number.isFinite(bestPrevious)) next.push({ at: candidate.at, score: bestPrevious + candidate.score });
      }
      states = next;
      if (!states.length) break;
    }
    const score = Math.min(...states.map(state => state.score));
    const valid = Number.isFinite(score);
    if (valid && (!best || score < best.score)) best = { lines, score };
  }
  return best?.lines || null;
}

export async function fetchRouteGeometry(route: Route, stops: Stop[], signal: AbortSignal) {
  if (!['KMB', 'CTB', 'GMB'].includes(route.company)) return null;
  const gmb = route.company === 'GMB';
  const dataset = gmb ? 'td_rcd_1697082463580_57453' : 'td_rcd_1638844988873_41214';
  const url = new URL(`https://portal.csdi.gov.hk/server/rest/services/common/${dataset}/FeatureServer/0/query`);
  url.search = new URLSearchParams({ f: 'geojson', where: gmb ? `ROUTE_ID=${Number(route.service)}` : `ROUTE_NAMEE='${route.route.replaceAll("'", "''")}'`, outFields: '*', outSR: '4326' }).toString();
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('route geometry unavailable');
  const data = await response.json();
  if (!Array.isArray(data.features)) throw new Error('invalid route geometry');
  return matchRouteGeometry(data.features, route, stops);
}
