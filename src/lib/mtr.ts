import { checkRequest, requestScope } from './request-scope';
import type { Arrival, Favourite, Route, Stop } from './bus';
import { connectionReason, reportConnection } from './connection';

export type MtrNetwork = {
  snapshot_at: string; routes: Route[]; stops: Stop[];
  rows: { company: 'MTR'; route: string; bound: string; service_type: string; stop: string; seq: number; pickup: boolean; dropoff: boolean }[];
};
let networkRequest: Promise<MtrNetwork> | undefined;
export function mtrNetwork(): Promise<MtrNetwork> {
  if (!networkRequest) networkRequest = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const source = '港鐵路綫及車站';
    try {
      const response = await fetch((import.meta.env?.BASE_URL || '/') + 'bus-data/mtr-network.json', { signal: controller.signal });
      if (!response.ok) throw new Error('港鐵路綫資料未能載入');
      const value = await response.json();
      if (!value.routes?.length || !value.stops?.length || !value.rows?.length || !Number.isFinite(Date.parse(value.snapshot_at))) throw new Error('港鐵路綫資料不完整');
      reportConnection(source);
      return value as MtrNetwork;
    } catch (error) { reportConnection(source, connectionReason(error)); throw error; }
    finally { clearTimeout(timer); }
  })().catch(error => { networkRequest = undefined; throw error; });
  return networkRequest;
}
export function mtrRouteStops(network: MtrNetwork, route: Route): Stop[] {
  const stops = new Map(network.stops.map(stop => [stop.id, stop]));
  return network.rows.filter(row => row.service_type === route.service && row.bound === route.bound)
    .sort((a, b) => a.seq - b.seq).map(row => ({ ...stops.get(row.stop)!, seq: row.seq, pickup: row.pickup, dropoff: row.dropoff }));
}
export function mtrEntries(network: MtrNetwork, id: string, routes: Route[]): Favourite[] {
  const stop = network.stops.find(stop => stop.id === id);
  if (!stop) return [];
  return network.rows.filter(row => row.stop === id && row.pickup).flatMap(row => {
    const route = routes.find(route => route.company === 'MTR' && route.service === row.service_type && route.bound === row.bound);
    return route ? [{ route, stop: { ...stop, seq: row.seq, pickup: row.pickup, dropoff: row.dropoff } }] : [];
  });
}
type Train = { seq: string; dest: string; plat: string; time: string; valid: string };
export type TrainResponse = { status: number; message?: string; isdelay?: string; data?: Record<string, { curr_time?: string; UP?: Train[]; DOWN?: Train[] }> };
export function parseMtrArrivals(value: TrainResponse, route: Route, stop: Stop, network: MtrNetwork, alight?: Stop, now = Date.now()): Arrival[] {
  if (Number(value.status) !== 1) throw new Error(value.message || '港鐵即時資料暫未能取得');
  const station = value.data?.[route.region + '-' + stop.id.slice(4)];
  if (!station) throw new Error('港鐵未有此站的即時資料');
  const sourceTime = station.curr_time ? Date.parse(station.curr_time.replace(' ', 'T') + '+08:00') : NaN;
  if (!Number.isFinite(sourceTime) || Math.abs(now - sourceTime) > 90000) throw new Error('港鐵即時資料已過時');
  const ordered = mtrRouteStops(network, route);
  const from = ordered.findIndex(row => row.id === stop.id);
  const target = alight ? ordered.findIndex(row => row.id === alight.id) : from + 1;
  if (from < 0 || target <= from) return [];
  const trains = route.bound === 'UP' ? station.UP : station.DOWN;
  return (trains || []).filter(train => train.valid === 'Y' && ordered.findIndex(row => row.id === 'MTR:' + train.dest) >= target)
    .map(train => ({
      eta: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(train.time) ? train.time.replace(' ', 'T') + '+08:00' : null,
      remark: '往 ' + (network.stops.find(stop => stop.id === 'MTR:' + train.dest)?.name || train.dest) + ' · ' + train.plat + ' 號月台' + (value.isdelay === 'Y' ? ' · 列車服務有延誤' : ''),
      seq: Number(train.seq), destinationStopId: 'MTR:' + train.dest,
    })).filter(row => row.eta && Number.isFinite(Date.parse(row.eta)) && Date.parse(row.eta) >= now - 60000)
    .sort((a, b) => Date.parse(a.eta!) - Date.parse(b.eta!)).slice(0, 3);
}
type Forecast = { at: number; value: Promise<TrainResponse> };
const forecasts = new Map<string, Forecast>();
const scopedForecasts = new WeakMap<AbortSignal, Map<string, Forecast>>();
async function trainSchedule(line: string, station: string, signal?: AbortSignal) {
  checkRequest(signal);
  const url = 'https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=' + encodeURIComponent(line) + '&sta=' + encodeURIComponent(station) + '&lang=TC';
  let cache = signal ? scopedForecasts.get(signal) : forecasts;
  if (!cache) { cache = new Map(); scopedForecasts.set(signal!, cache); }
  const saved = cache.get(url);
  if (saved && Date.now() - saved.at < 5000) return saved.value;
  const request = (async () => {
    for (let attempt = 0; ; attempt++) {
      checkRequest(signal);
      const scope = requestScope(signal, 15000);
      try {
        const response = await fetch(url + (attempt ? '&retry=' + Date.now() : ''), { signal: scope.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('港鐵接口回應 HTTP ' + response.status);
        const value = await response.json() as TrainResponse;
        if (Number(value.status) !== 1) throw new Error(value.message || '港鐵即時資料暫未能取得');
        reportConnection(url);
        return value;
      } catch (error) { checkRequest(signal); if (attempt) { reportConnection(url, connectionReason(error)); throw error; } }
      finally { scope.dispose(); }
    }
  })().catch(error => { cache.delete(url); throw error; });
  cache.set(url, { at: Date.now(), value: request });
  return request;
}
export async function mtrArrivals(route: Route, stop: Stop, alight?: Stop, signal?: AbortSignal): Promise<Arrival[]> {
  const [network, value] = await Promise.all([mtrNetwork(), trainSchedule(route.region!, stop.id.slice(4), signal)]);
  return parseMtrArrivals(value, route, stop, network, alight);
}
export function transferWalk(a: Stop, b: Stop, meters: number): number | null {
  const rail = a.id.startsWith('MTR:') || b.id.startsWith('MTR:');
  const pair = [a.id, b.id].sort().join('/');
  if (pair === 'MTR:CEN/MTR:HOK' || pair === 'MTR:ETS/MTR:TST') return Math.max(meters, 500);
  if (meters > (rail ? 400 : 200)) return null;
  return meters;
}
