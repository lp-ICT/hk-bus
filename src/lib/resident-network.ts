import type { Route, Stop } from './bus';
import type { RouteStop } from './journey';

export type ResidentNetwork = { version: number; snapshot_at: string; routes: Route[]; stops: Stop[]; rows: RouteStop[] };
let request: Promise<ResidentNetwork> | undefined;
export function residentNetwork(): Promise<ResidentNetwork> {
  if (!request) request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${import.meta.env?.BASE_URL || '/'}bus-data/resident-network.json`, { signal: controller.signal });
      if (!response.ok) throw new Error('居民巴士資料未能載入');
      const value = await response.json();
      if (value.version !== 1 || !value.routes?.length || !value.stops?.length || !value.rows?.length) throw new Error('居民巴士資料不完整');
      return value as ResidentNetwork;
    } finally { clearTimeout(timer); }
  })().catch(error => { request = undefined; throw error; });
  return request;
}
export function residentRouteStops(network: ResidentNetwork, route: Route): Stop[] {
  const stops = new Map(network.stops.map(stop => [stop.id, stop]));
  return network.rows.filter(row => row.service_type === route.service && row.bound === route.bound).map(row => ({ ...stops.get(row.stop)!, seq: Number(row.seq), pickup: row.pickup, dropoff: row.dropoff, etaAvailable: false })).sort((a, b) => a.seq - b.seq);
}
