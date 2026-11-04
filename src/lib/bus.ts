export type Company = 'KMB' | 'CTB';
export type Route = { company: Company; route: string; bound: string; service: string; from: string; to: string };
export type Stop = { id: string; name: string; lat: number; lng: number; seq: number };
export type Favourite = { route: Route; stop: Stop };
export type Arrival = { eta: string | null; remark: string; seq: number };
const bases = { KMB: 'https://data.etabus.gov.hk/v1/transport/kmb', CTB: 'https://rt.data.gov.hk/v2/transport/citybus' };
const memory = new Map<string, { at: number; value: unknown }>();
const requests = new Map<string, Promise<unknown>>();

async function data<T>(url: string, cache = true): Promise<T> {
  const key = `bus-v1:${url}`;
  if (cache) {
    const hit = typeof window !== 'undefined' ? memory.get(url) : undefined;
    if (hit && Date.now() - hit.at < 86400000) return hit.value as T;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && Date.now() - saved.at < 86400000) return saved.value;
    } catch {}
    if (requests.has(url)) return requests.get(url) as Promise<T>;
  }
  const request = (async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(18000), cache: cache ? 'default' : 'no-store' });
    if (!response.ok) throw new Error('巴士公司暫時未能提供資料，請稍後重試。');
    const json = await response.json();
    if (!('data' in json)) throw new Error('收到的巴士資料不完整。');
    if (cache) {
      if (typeof window !== 'undefined') memory.set(url, { at: Date.now(), value: json.data });
      try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), value: json.data })); } catch {}
    }
    return json.data as T;
  })();
  if (cache) requests.set(url, request);
  try { return await request; } finally { if (cache) requests.delete(url); }
}

export function routeKey(r: Route) { return `${r.company}-${r.route}-${r.bound}-${r.service}`; }
export function favouriteKey(f: Favourite) { return `${routeKey(f.route)}-${f.stop.id}-${f.stop.seq}`; }
export function companyName(c: Company) { return c === 'KMB' ? '九巴 / 龍運' : '城巴'; }
type Raw = Record<string, string | number>;
export async function routesFor(company: Company): Promise<Route[]> {
  const rows = await data<Raw[]>(`${bases[company]}/route/${company === 'CTB' ? 'CTB' : ''}`);
  return rows.flatMap(row => (company === 'CTB' ? ['O', 'I'] : [String(row.bound)]).map(bound => ({
    company, route: String(row.route), bound, service: String(row.service_type || '1'),
    from: String(bound === 'I' && company === 'CTB' ? row.dest_tc : row.orig_tc),
    to: String(bound === 'I' && company === 'CTB' ? row.orig_tc : row.dest_tc),
  })));
}

export async function allKmbStops(): Promise<Stop[]> {
  const rows = await data<Raw[]>(`${bases.KMB}/stop`);
  return rows.map(row => ({ id: String(row.stop), name: String(row.name_tc), lat: Number(row.lat), lng: Number(row.long), seq: 0 }));
}

export function searchStops(stops: Stop[], query: string): Stop[] {
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  const term = normalize(query);
  if (!term) return [];
  return stops.filter(stop => normalize(stop.name).includes(term) || normalize(stop.id) === term)
    .sort((a, b) => Number(normalize(b.name) === term) - Number(normalize(a.name) === term) || a.name.localeCompare(b.name, 'zh-HK') || a.id.localeCompare(b.id));
}

export async function stopsFor(route: Route): Promise<Stop[]> {
  const direction = route.bound === 'O' ? 'outbound' : 'inbound';
  const path = route.company === 'KMB' ? `/route-stop/${route.route}/${direction}/${route.service}` : `/route-stop/CTB/${route.route}/${direction}`;
  const rows = await data<Raw[]>(bases[route.company] + path);
  if (route.company === 'KMB') {
    const stops = new Map((await allKmbStops()).map(stop => [stop.id, stop]));
    return rows.map(row => ({ ...(stops.get(String(row.stop)) || { id: String(row.stop), name: String(row.stop), lat: 0, lng: 0 }), seq: Number(row.seq) }));
  }
  const result: Stop[] = [];
  for (let offset = 0; offset < rows.length; offset += 6) {
    result.push(...await Promise.all(rows.slice(offset, offset + 6).map(async row => {
      const stop = await data<Raw>(`${bases.CTB}/stop/${row.stop}`);
      return { id: String(row.stop), name: String(stop.name_tc), lat: Number(stop.lat), lng: Number(stop.long), seq: Number(row.seq) };
    })));
  }
  return result;
}

export async function arrivalsFor(route: Route, stop: Stop): Promise<Arrival[]> {
  const path = route.company === 'KMB' ? `/eta/${stop.id}/${route.route}/${route.service}` : `/eta/CTB/${stop.id}/${route.route}`;
  const rows = await data<Raw[]>(bases[route.company] + path, false);
  return rows.filter(row => String(row.dir) === route.bound && Number(row.seq) === stop.seq && (route.company !== 'KMB' || String(row.service_type) === route.service))
    .map(row => ({ eta: row.eta ? String(row.eta) : null, remark: String(row.rmk_tc || ''), seq: Number(row.eta_seq) }))
    .filter(row => !row.eta || Date.parse(row.eta) > Date.now() - 60000)
    .sort((a, b) => a.seq - b.seq).slice(0, 3);
}

export async function routesAtStop(id: string, routes: Route[]): Promise<Favourite[]> {
  const rows = await data<Raw[]>(`${bases.KMB}/route-stop`);
  const stop = (await allKmbStops()).find(stop => stop.id === id);
  if (!stop) return [];
  return rows.filter(row => String(row.stop) === id).flatMap(row => {
    const route = routes.find(route => route.company === 'KMB' && route.route === String(row.route) && route.bound === String(row.bound) && route.service === String(row.service_type));
    return route ? [{ route, stop: { ...stop, seq: Number(row.seq) } }] : [];
  });
}

export function distance(lat: number, lng: number, stop: Stop) {
  const rad = (v: number) => v * Math.PI / 180;
  const a = Math.sin(rad(stop.lat - lat) / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(stop.lat)) * Math.sin(rad(stop.lng - lng) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function arrivalLabel(eta: string | null, now = Date.now()) {
  if (!eta || !Number.isFinite(Date.parse(eta))) return '未有預報';
  const minutes = Math.ceil((Date.parse(eta) - now) / 60000);
  return minutes <= 1 ? '即將到站' : `${minutes} 分鐘`;
}

export function noArrivalMessage(arrivals: Arrival[]) {
  const remarks = arrivals.filter(a => !a.eta).map(a => a.remark.trim()).filter(Boolean);
  if (remarks.length && remarks.every(remark => /服務已結束|尾班車已過|已過尾班車|末班車已過/.test(remark))) return '服務已結束';
  return remarks.find(remark => !/服務已結束|尾班車已過|已過尾班車|末班車已過/.test(remark)) || '暫未有到站預報';
}

export function distanceLabel(meters: number) {
  return meters >= 1000 ? `距你約 ${(meters / 1000).toFixed(1)} 公里（直線）` : `距你約 ${Math.round(meters)} 米（直線）`;
}

export function schoolSideStops<T extends Stop>(stops: T[], side: 'entrance' | 'opposite') {
  const ids = side === 'entrance' ? ['0A1DAEAFFDFF0B66', '97BB9CE7A058E809'] : ['DEDD6247441C8C05'];
  return stops.filter(stop => ids.includes(stop.id));
}

export type NearbyArrival = Favourite & { meters: number; arrivals: Arrival[]; error: boolean };
export async function nearbyArrivals(stop: Stop & { meters: number }, routes: Route[]): Promise<NearbyArrival[]> {
  const entries = await routesAtStop(stop.id, routes);
  try {
    const rows = await data<Raw[]>(`${bases.KMB}/stop-eta/${stop.id}`, false);
    return entries.map(entry => ({ ...entry, meters: stop.meters, error: false, arrivals: rows
      .filter(row => String(row.route) === entry.route.route && String(row.dir) === entry.route.bound && String(row.service_type) === entry.route.service && Number(row.seq) === entry.stop.seq)
      .map(row => ({ eta: row.eta ? String(row.eta) : null, remark: String(row.rmk_tc || ''), seq: Number(row.eta_seq) }))
      .filter(row => !row.eta || Date.parse(row.eta) > Date.now() - 60000)
      .sort((a, b) => a.seq - b.seq).slice(0, 3) }));
  } catch { return entries.map(entry => ({ ...entry, meters: stop.meters, arrivals: [], error: true })); }
}
export function sortNearby(rows: NearbyArrival[], now = Date.now()) {
  const first = (row: NearbyArrival) => Math.min(...row.arrivals.map(a => a.eta ? Date.parse(a.eta) : Infinity).filter(time => Number.isFinite(time) && time > now - 60000));
  return [...rows].sort((a, b) => first(a) - first(b) || a.meters - b.meters || a.route.route.localeCompare(b.route.route, 'en', { numeric: true }));
}

export function nearestRoutes(rows: NearbyArrival[]): NearbyArrival[] {
  const groups = new Map<string, NearbyArrival[]>();
  for (const row of rows) {
    const key = `${row.route.company}-${row.route.route}-${row.route.bound}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups.values()].map(group => {
    group.sort((a, b) => a.meters - b.meters || a.stop.seq - b.stop.seq || a.route.service.localeCompare(b.route.service, 'en', { numeric: true }));
    const nearest = group[0];
    const sameStop = group.filter(row => row.stop.id === nearest.stop.id && row.stop.seq === nearest.stop.seq);
    const arrivals = sameStop.flatMap(row => row.arrivals).filter(a => a.eta && Number.isFinite(Date.parse(a.eta)))
      .sort((a, b) => Date.parse(a.eta!) - Date.parse(b.eta!));
    return { ...nearest, error: sameStop.some(row => row.error), arrivals: arrivals.length ? arrivals.filter((a, i) => i === 0 || a.eta !== arrivals[i - 1].eta).slice(0, 3) : sameStop.flatMap(row => row.arrivals).filter(a => !a.eta).slice(0, 3) };
  });
}
