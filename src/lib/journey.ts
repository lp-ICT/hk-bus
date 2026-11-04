import proj4 from 'proj4';
import { allKmbStops, distance, routeKey, searchStops, type Favourite, type Route, type Stop } from './bus';

export type Place = { name: string; lat: number; lng: number; detail?: string };
export type Journey = Favourite & { alight: Stop; meters: number; endMeters: number; nearby: boolean };
export type RouteStop = { route: string; bound: string; service_type: string | number; stop: string; seq: string | number };
const hk80 = '+proj=tmerc +lat_0=22.3121333333333 +lon_0=114.178555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,-0.067753,2.243648,1.158828,-1.094246 +units=m +no_defs';
export function hkPlace(name: string, x: number, y: number, detail?: string): Place {
  const [lng, lat] = proj4(hk80, 'EPSG:4326', [x, y]);
  return { name, lat, lng, detail };
}
export const schoolPlace = hkPlace('聖公會李炳中學', 831919, 826830, '荃灣區 · 和宜合道450號');
export const schoolStopIds = ['0A1DAEAFFDFF0B66', '97BB9CE7A058E809', 'DEDD6247441C8C05'];

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const term = query.trim();
  if (!term) return [];
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 12000);
  try {
    const response = await fetch('https://www.map.gov.hk/gs/api/v1.0.0/locationSearch?q=' + encodeURIComponent(term), { signal: controller.signal });
    if (!response.ok) throw new Error('地點服務暫時未能連線');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('地點資料格式不完整');
    return rows.filter(row => Number.isFinite(row.x) && Number.isFinite(row.y))
      .map(row => hkPlace(row.nameZH || row.nameEN, row.x, row.y, [row.districtZH, row.addressZH].filter(Boolean).join(' · '))).slice(0, 12);
  } catch (error) {
    if (signal?.aborted) throw error;
    const stops = searchStops(await allKmbStops(), term).slice(0, 12);
    if (!stops.length) throw new Error('未能查詢地點，請重試或輸入巴士站名稱。');
    return stops.map(stop => ({ ...stop, detail: '巴士站位置 · ' + stop.id }));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

let graphRequest: Promise<{ stops: Stop[]; rows: RouteStop[]; snapshotAt: string }> | undefined;
export function journeyGraph() {
  if (!graphRequest) {
    graphRequest = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const base = import.meta.env?.BASE_URL || '/';
        const responses = await Promise.all(['kmb-stops', 'kmb-route-stops'].map(name => fetch(base + 'bus-data/' + name + '.json', { signal: controller.signal })));
        if (responses.some(response => !response.ok)) throw new Error('車站及路線資料未能載入');
        const [stops, routeStops] = await Promise.all(responses.map(response => response.json()));
        if (!Array.isArray(stops.data) || !stops.data.length || !Array.isArray(routeStops.data) || !routeStops.data.length || !Number.isFinite(Date.parse(routeStops.snapshot_at))) throw new Error('車站及路線資料不完整');
        return { stops: stops.data.map((row: Record<string, string>) => ({ id: row.stop, name: row.name_tc, lat: Number(row.lat), lng: Number(row.long), seq: 0 })), rows: routeStops.data as RouteStop[], snapshotAt: routeStops.snapshot_at as string };
      } finally { clearTimeout(timer); }
    })().catch(error => { graphRequest = undefined; throw error; });
  }
  return graphRequest;
}

export function directJourneys(routes: Route[], stops: Stop[], rows: RouteStop[], origin: Place | null, destination: Place, allToDestination = false, alightingIds?: string[]): Journey[] {
  const stopMap = new Map(stops.map(stop => [stop.id, stop]));
  const accessible = (stop: Stop, place: Place | null) => !/隧道轉車站|隧道收費廣場/.test(stop.name) || !!place?.name.includes('隧道');
  const destinations = new Map(stops.filter(stop => alightingIds ? alightingIds.includes(stop.id) : accessible(stop, destination) && distance(destination.lat, destination.lng, stop) <= 400).map(stop => [stop.id, distance(destination.lat, destination.lng, stop)]));
  const routeMap = new Map(routes.filter(route => route.company === 'KMB').map(route => [routeKey(route), route]));
  const grouped = new Map<string, RouteStop[]>();
  for (const row of rows) {
    const key = 'KMB-' + row.route + '-' + row.bound + '-' + row.service_type;
    if (!routeMap.has(key)) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }
  const results: Journey[] = [];
  for (const [key, routeStops] of grouped) {
    const route = routeMap.get(key)!;
    const ordered = routeStops.map(row => {
      const stop = stopMap.get(row.stop);
      return stop ? { ...stop, seq: Number(row.seq) } : null;
    }).filter((stop): stop is Stop => !!stop).sort((a, b) => a.seq - b.seq);
    let best: Journey | undefined;
    for (const alight of ordered.filter(stop => destinations.has(stop.id))) {
      for (const stop of ordered) {
        if (stop.seq >= alight.seq || stop.id === alight.id || !accessible(stop, origin)) continue;
        const meters = origin ? distance(origin.lat, origin.lng, stop) : Infinity;
        if (!allToDestination && (!origin || meters > 1000)) continue;
        const candidate: Journey = { route, stop, alight, meters, endMeters: destinations.get(alight.id)!, nearby: !!origin && meters <= 1000 };
        if (!best || meters < best.meters || meters === best.meters && candidate.endMeters < best.endMeters || meters === best.meters && candidate.endMeters === best.endMeters && stop.seq < best.stop.seq) best = candidate;
      }
    }
    if (best) results.push(best);
  }
  const nearest = new Map<string, Journey>();
  for (const journey of results) {
    const key = journey.route.company + '-' + journey.route.route + '-' + journey.route.bound;
    const previous = nearest.get(key);
    if (!previous || journey.meters < previous.meters || journey.meters === previous.meters && Number(journey.route.service) < Number(previous.route.service)) nearest.set(key, journey);
  }
  return [...nearest.values()].sort((a, b) => Number(b.nearby) - Number(a.nearby) || a.route.route.localeCompare(b.route.route, 'en', { numeric: true }));
}

export function currentPlace(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('瀏覽器不支援定位，請輸入起點。')); return; }
    navigator.geolocation.getCurrentPosition(position => resolve({ name: '目前位置', lat: position.coords.latitude, lng: position.coords.longitude }), () => reject(new Error('未能取得位置，請允許定位或自行輸入起點。')), { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
  });
}
