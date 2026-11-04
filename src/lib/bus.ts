import { connectionReason, reportConnection } from './connection';

export type Company = 'KMB' | 'CTB' | 'GMB';
export type Route = { company: Company; route: string; bound: string; service: string; from: string; to: string; region?: string; description?: string };
export type Stop = { id: string; name: string; lat: number; lng: number; seq: number; pickup?: boolean; dropoff?: boolean };
export type Favourite = { route: Route; stop: Stop };
export type Arrival = { eta: string | null; remark: string; seq: number };
const bases = { KMB: 'https://data.etabus.gov.hk/v1/transport/kmb', CTB: 'https://rt.data.gov.hk/v2/transport/citybus' };
const memory = new Map<string, { at: number; value: unknown; backupAt?: string }>();
const metadataFiles: Record<string, string> = {
  [`${bases.KMB}/route/`]: 'kmb-routes',
  [`${bases.KMB}/stop`]: 'kmb-stops',
  [`${bases.KMB}/route-stop`]: 'kmb-route-stops',
  [`${bases.CTB}/route/CTB`]: 'ctb-routes',
};
const requests = new Map<string, Promise<unknown>>();

async function fetchBusData(url: string, cache: boolean) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    try {
      const target = attempt ? `${url}${url.includes('?') ? '&' : '?'}retry=${Date.now()}` : url;
      const response = await fetch(target, { signal: controller.signal, cache: attempt || !cache ? 'no-store' : 'default' });
      if (!response.ok) throw new Error(`官方接口回應 HTTP ${response.status}`);
      const json = await response.json();
      if (!json || typeof json !== 'object' || !('data' in json)) throw new Error('收到的巴士資料不完整。');
      reportConnection(url, undefined);
      return json;
    } catch (error) {
      if (attempt) {
        const reason = connectionReason(error);
        reportConnection(url, reason);
        const routeStop = url.startsWith(`${bases.KMB}/route-stop/`) ? url.slice(`${bases.KMB}/route-stop/`.length).match(/^([^/]+)\/(outbound|inbound)\/([^/]+)$/) : null;
        const file = cache && (metadataFiles[url] || (routeStop ? 'kmb-route-stops' : undefined));
        if (file) {
          const backupController = new AbortController();
          const backupTimer = setTimeout(() => backupController.abort(), 10000);
          try {
            const response = await fetch(`${import.meta.env?.BASE_URL || '/'}bus-data/${file}.json`, { signal: backupController.signal });
            if (!response.ok) throw new Error(`備援接口回應 HTTP ${response.status}`);
            const backup = await response.json();
            if (!Array.isArray(backup.data) || !backup.data.length || !Number.isFinite(Date.parse(backup.snapshot_at))) throw new Error('備援資料不完整');
            if (routeStop) backup.data = backup.data.filter((row: Raw) => String(row.route) === routeStop[1] && String(row.bound) === (routeStop[2] === 'outbound' ? 'O' : 'I') && String(row.service_type) === routeStop[3]);
            if (!backup.data.length) throw new Error('備援未有此路線資料');
            reportConnection(url, reason, backup.snapshot_at);
            return backup;
          } catch (backupError) {
            reportConnection(url, `${reason}；備援亦失敗：${connectionReason(backupError)}`);
          } finally { clearTimeout(backupTimer); }
        }
        throw error;
      }
    } finally { clearTimeout(timer); }
  }
}

export async function data<T>(url: string, cache = true): Promise<T> {
  const key = `bus-v1:${url}`;
  if (cache) {
    const hit = typeof window !== 'undefined' ? memory.get(url) : undefined;
    if (hit && Date.now() - hit.at < 86400000) {
      if (hit.backupAt) reportConnection(url, '使用已暫存的備援路線／車站資料', hit.backupAt);
      return hit.value as T;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && Date.now() - saved.at < 86400000) {
        if (saved.backupAt) reportConnection(url, '使用已暫存的備援路線／車站資料', saved.backupAt);
        return saved.value;
      }
    } catch {}
    if (requests.has(url)) return requests.get(url) as Promise<T>;
  }
  const request = (async () => {
    const json = await fetchBusData(url, cache);
    if (cache) {
      const saved = { at: Date.now(), value: json.data, backupAt: json.snapshot_at as string | undefined };
      if (typeof window !== 'undefined') memory.set(url, saved);
      try { localStorage.setItem(key, JSON.stringify(saved)); } catch {}
    }
    return json.data as T;
  })();
  if (cache) requests.set(url, request);
  try { return await request; } finally { if (cache) requests.delete(url); }
}

export function routeKey(r: Route) { return `${r.company}-${r.route}-${r.bound}-${r.service}`; }
export function favouriteKey(f: Favourite) { return `${routeKey(f.route)}-${f.stop.id}-${f.stop.seq}`; }
export function companyName(c: Company) { return c === 'KMB' ? '九巴 / 龍運' : c === 'GMB' ? '綠色小巴' : '城巴'; }
type Raw = Record<string, string | number>;
export async function routesFor(company: Company): Promise<Route[]> {
  if (company === 'GMB') return (await gmbNetwork()).routes;
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
  if (route.company === 'GMB') {
    const network = await gmbNetwork();
    const stops = new Map(network.stops.map(stop => [stop.id, stop]));
    return network.rows.filter(row => row.service_type === route.service && row.bound === route.bound).map(row => ({ ...stops.get(row.stop)!, name: row.name, seq: Number(row.seq) }));
  }
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
  if (route.company === 'GMB') {
    const result = await data<{ enabled: boolean; eta: { timestamp: string; remarks_tc: string | null; eta_seq: number }[] }>(`https://data.etagmb.gov.hk/eta/route-stop/${route.service}/${route.bound}/${stop.seq}`, false);
    if (!result.enabled) return [{ eta: null, remark: '此站暫未提供即時預報', seq: 1 }];
    return result.eta.map(row => ({ eta: row.timestamp || null, remark: row.remarks_tc || '', seq: row.eta_seq })).filter(row => !row.eta || Date.parse(row.eta) > Date.now() - 60000).sort((a, b) => a.seq - b.seq).slice(0, 3);
  }
  const path = route.company === 'KMB' ? `/eta/${stop.id}/${route.route}/${route.service}` : `/eta/CTB/${stop.id}/${route.route}`;
  const rows = await data<Raw[]>(bases[route.company] + path, false);
  return rows.filter(row => String(row.dir) === route.bound && Number(row.seq) === stop.seq && (route.company !== 'KMB' || String(row.service_type) === route.service))
    .map(row => ({ eta: row.eta ? String(row.eta) : null, remark: String(row.rmk_tc || ''), seq: Number(row.eta_seq) }))
    .filter(row => !row.eta || Date.parse(row.eta) > Date.now() - 60000)
    .sort((a, b) => a.seq - b.seq).slice(0, 3);
}

export async function routesAtStop(id: string, routes: Route[]): Promise<Favourite[]> {
  if (id.startsWith('GMB:')) {
    const network = await gmbNetwork();
    const stop = network.stops.find(stop => stop.id === id);
    if (!stop) return [];
    return network.rows.filter(row => row.stop === id).flatMap(row => {
      const route = routes.find(route => route.company === 'GMB' && route.service === row.service_type && route.bound === row.bound);
      return route ? [{ route, stop: { ...stop, name: row.name, seq: Number(row.seq) } }] : [];
    });
  }
  const rows = await data<Raw[]>(`${bases.KMB}/route-stop`);
  const stop = (await allKmbStops()).find(stop => stop.id === id);
  if (!stop) return [];
  return rows.filter(row => String(row.stop) === id).flatMap(row => {
    const route = routes.find(route => route.company === 'KMB' && route.route === String(row.route) && route.bound === String(row.bound) && route.service === String(row.service_type));
    return route ? [{ route, stop: { ...stop, seq: Number(row.seq) } }] : [];
  });
}

export function distance(lat: number, lng: number, stop: Stop) {
  if ((!stop.lat && !stop.lng) || (!lat && !lng)) return Infinity;
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
  if (!Number.isFinite(meters)) return '暫未有車站位置資料';
  return meters >= 1000 ? `距你約 ${(meters / 1000).toFixed(1)} 公里（直線）` : `距你約 ${Math.round(meters)} 米（直線）`;
}

export function schoolSideStops<T extends Stop>(stops: T[], side: 'entrance' | 'opposite') {
  const ids = side === 'entrance' ? ['0A1DAEAFFDFF0B66', '97BB9CE7A058E809', 'GMB:20001848'] : ['DEDD6247441C8C05'];
  return stops.filter(stop => ids.includes(stop.id));
}

export type NearbyArrival = Favourite & { meters: number; arrivals: Arrival[]; error: boolean };
export async function nearbyArrivals(stop: Stop & { meters: number }, routes: Route[]): Promise<NearbyArrival[]> {
  const entries = await routesAtStop(stop.id, routes);
  if (stop.id.startsWith('GMB:')) return Promise.all(entries.map(async entry => {
    try { return { ...entry, meters: stop.meters, arrivals: await arrivalsFor(entry.route, entry.stop), error: false }; }
    catch { return { ...entry, meters: stop.meters, arrivals: [], error: true }; }
  }));
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
    const key = `${row.route.company}-${row.route.route}-${row.route.bound}${row.route.company === 'GMB' ? '-' + row.route.service : ''}`;
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

export type GmbNetwork = {
  routes: Route[]; stops: Stop[]; snapshot_at: string;
  rows: { company: 'GMB'; route: string; bound: string; service_type: string; stop: string; seq: number; name: string }[];
};
let gmbRequest: Promise<GmbNetwork> | undefined;
export function gmbNetwork(): Promise<GmbNetwork> {
  if (!gmbRequest) gmbRequest = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${import.meta.env?.BASE_URL || '/'}bus-data/gmb-network.json`, { signal: controller.signal });
      if (!response.ok) throw new Error('小巴路線資料未能載入');
      const result = await response.json();
      if (!result.routes?.length || !result.stops?.length || !result.rows?.length || !Number.isFinite(Date.parse(result.snapshot_at))) throw new Error('小巴路線資料不完整');
      return result as GmbNetwork;
    } finally { clearTimeout(timer); }
  })().catch(error => { gmbRequest = undefined; throw error; });
  return gmbRequest;
}
export async function allTransitStops(): Promise<Stop[]> {
  const results = await Promise.allSettled([allKmbStops(), gmbNetwork().then(network => network.stops)]);
  if (results.every(result => result.status === 'rejected')) throw new Error('車站資料未能載入');
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}
export function routeDescription(route: Route) {
  if (route.company === 'GMB') return ({ HKI: '港島', KLN: '九龍', NT: '新界' }[route.region || ''] || '') + (route.description && route.description !== '正常班次' ? ' · ' + route.description : '');
  return route.service !== '1' ? '特別班次 ' + route.service : '';
}
