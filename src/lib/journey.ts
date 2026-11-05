import proj4 from 'proj4';
import type { JourneyTimes } from './journey-time';
import { allKmbStops, gmbNetwork, distance, routeKey, searchStops, type Favourite, type Route, type Stop } from './bus';

export type Place = { name: string; lat: number; lng: number; detail?: string };
export type Journey = Favourite & { alight: Stop; meters: number; endMeters: number; nearby: boolean; rideMinutes?: number; transfer?: { leg: Journey; meters: number } };
export type RouteStop = { route: string; bound: string; service_type: string | number; stop: string; seq: string | number; company?: 'KMB' | 'GMB'; pickup?: boolean; dropoff?: boolean };
const hk80 = '+proj=tmerc +lat_0=22.3121333333333 +lon_0=114.178555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,-0.067753,2.243648,1.158828,-1.094246 +units=m +no_defs';
export function hkPlace(name: string, x: number, y: number, detail?: string): Place {
  const [lng, lat] = proj4(hk80, 'EPSG:4326', [x, y]);
  return { name, lat, lng, detail };
}
export const schoolPlace = hkPlace('聖公會李炳中學', 831919, 826830, '荃灣區 · 和宜合道450號');
export const schoolStopIds = ['0A1DAEAFFDFF0B66', '97BB9CE7A058E809', 'DEDD6247441C8C05'];
export function schoolDestinationStops(stops: Stop[]) {
  return stops.filter(stop => schoolStopIds.includes(stop.id) || stop.id.startsWith('GMB:') && distance(schoolPlace.lat, schoolPlace.lng, stop) <= 400).map(stop => stop.id);
}

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

let graphRequest: Promise<{ stops: Stop[]; rows: RouteStop[]; snapshotAt: string; times?: JourneyTimes }> | undefined;
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
        const gmb = await gmbNetwork();
        let times: JourneyTimes | undefined;
        try {
          const response = await fetch(base + 'bus-data/journey-times.json', { signal: controller.signal });
          const value = response.ok ? await response.json() : null;
          if (value?.version === 1 && value.routes && typeof value.routes === 'object') times = value;
        } catch {}
        return { stops: [...gmb.stops, ...stops.data.map((row: Record<string, string>) => ({ id: row.stop, name: row.name_tc, lat: Number(row.lat), lng: Number(row.long), seq: 0 }))], rows: [...routeStops.data as RouteStop[], ...gmb.rows], snapshotAt: routeStops.snapshot_at as string, times };
      } finally { clearTimeout(timer); }
    })().catch(error => { graphRequest = undefined; throw error; });
  }
  return graphRequest;
}

export function directJourneys(routes: Route[], stops: Stop[], rows: RouteStop[], origin: Place | null, destination: Place, allToDestination = false, alightingIds?: string[]): Journey[] {
  const stopMap = new Map(stops.map(stop => [stop.id, stop]));
  const accessible = (stop: Stop, place: Place | null) => !/隧道轉車站|隧道收費廣場/.test(stop.name) || !!place?.name.includes('隧道');
  const destinations = new Map(stops.filter(stop => alightingIds ? alightingIds.includes(stop.id) : accessible(stop, destination) && distance(destination.lat, destination.lng, stop) <= 400).map(stop => [stop.id, distance(destination.lat, destination.lng, stop)]));
  const routeMap = new Map(routes.filter(route => route.company !== 'CTB').map(route => [routeKey(route), route]));
  const grouped = new Map<string, RouteStop[]>();
  for (const row of rows) {
    const key = (row.company || 'KMB') + '-' + row.route + '-' + row.bound + '-' + row.service_type;
    if (!routeMap.has(key)) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }
  const results: Journey[] = [];
  for (const [key, routeStops] of grouped) {
    const route = routeMap.get(key)!;
    const ordered = routeStops.map(row => {
      const stop = stopMap.get(row.stop);
      return stop ? { ...stop, seq: Number(row.seq), pickup: row.pickup, dropoff: row.dropoff, etaAvailable: row.company === 'GMB' ? Number.isInteger(Number(row.seq)) : undefined } as Stop : null;
    }).filter((stop): stop is Stop => !!stop).sort((a, b) => a.seq - b.seq);
    let best: Journey | undefined;
    for (const alight of ordered.filter(stop => stop.dropoff !== false && destinations.has(stop.id))) {
      for (const stop of ordered) {
        if (stop.pickup === false || stop.seq >= alight.seq || stop.id === alight.id || !accessible(stop, origin)) continue;
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
    const key = journey.route.company + '-' + journey.route.route + '-' + journey.route.bound + (journey.route.company === 'GMB' ? '-' + journey.route.service : '');
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

export function journeyLegs(journey: Journey): Journey[] {
  return [journey, ...(journey.transfer ? journeyLegs(journey.transfer.leg) : [])];
}

export function isReverseDetour(direct: Journey, alternative: Journey) {
  return !direct.transfer && !!alternative.transfer && direct.nearby && alternative.nearby &&
    direct.route.company === alternative.route.company &&
    direct.route.route.trim().toUpperCase() === alternative.route.route.trim().toUpperCase() &&
    direct.route.bound !== alternative.route.bound &&
    (direct.route.company !== 'GMB' || direct.route.service === alternative.route.service && direct.route.region === alternative.route.region) &&
    direct.meters <= alternative.meters + 200 &&
    distance(direct.stop.lat, direct.stop.lng, alternative.stop) <= 200;
}

export function planJourneys(routes: Route[], stops: Stop[], rows: RouteStop[], origin: Place, destination: Place, alightingIds?: string[], preferredRoutes: Route[] = []) {
  const direct = directJourneys(routes, stops, rows, origin, destination, false, alightingIds);
  return [...direct, ...transferJourneys(routes, stops, rows, origin, destination, alightingIds, true, preferredRoutes)];
}

export function transferJourneys(routes: Route[], stops: Stop[], rows: RouteStop[], origin: Place, destination: Place, alightingIds?: string[], includeTwo = false, preferredRoutes: Route[] = []): Journey[] {
  const stopMap = new Map(stops.map(stop => [stop.id, stop]));
  const routeMap = new Map(routes.filter(route => route.company !== 'CTB').map(route => [routeKey(route), route]));
  const grouped = new Map<string, Stop[]>();
  for (const row of rows) {
    const key = `${row.company || 'KMB'}-${row.route}-${row.bound}-${row.service_type}`;
    const stop = stopMap.get(row.stop);
    if (!stop || !routeMap.has(key)) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({ ...stop, seq: Number(row.seq), pickup: row.pickup, dropoff: row.dropoff, etaAvailable: row.company === 'GMB' ? Number.isInteger(Number(row.seq)) : undefined });
  }
  const restricted = (stop: Stop) => /隧道轉車站|隧道收費廣場/.test(stop.name);
  const destinations = new Set(stops.filter(stop => alightingIds ? alightingIds.includes(stop.id) : !restricted(stop) && distance(destination.lat, destination.lng, stop) <= 400).map(stop => stop.id));
  const identity = (route: Route) => `${route.company}-${route.route}-${route.company === 'GMB' ? route.region + '-' + route.service : ''}`;
  const score = (journey: Journey): number => journey.endMeters + journeyLegs(journey).reduce((sum, leg) => sum + (leg.alight.seq - leg.stop.seq) * 80 + (leg.transfer?.meters || 0) * 3, 0);
  let tails: Journey[] = [];
  for (const [key, ordered] of grouped) {
    ordered.sort((a, b) => a.seq - b.seq);
    const alight = ordered.find(stop => stop.dropoff !== false && destinations.has(stop.id));
    if (!alight) continue;
    for (const stop of ordered) {
      const later = ordered.find(exit => exit.seq > stop.seq && exit.id !== stop.id && exit.dropoff !== false && destinations.has(exit.id));
      if (stop.pickup === false || !later) continue;
      tails.push({ route: routeMap.get(key)!, stop, alight: later, meters: 0, endMeters: distance(destination.lat, destination.lng, later), nearby: true });
    }
  }
  if (!stops.some(stop => !restricted(stop) && distance(origin.lat, origin.lng, stop) <= 1000)) return [];
  const preferred = (journey: Journey) => preferredRoutes.length > 0 && journeyLegs(journey).some(leg => preferredRoutes.some(saved =>
    saved.company === leg.route.company && saved.route.trim().toUpperCase() === leg.route.route.trim().toUpperCase() &&
    saved.bound === leg.route.bound && (leg.route.company !== 'GMB' || saved.service === leg.route.service)));
  const alternatives: Journey[] = [];
  for (let transfers = 1; transfers <= 2; transfers++) {
    const metadata = new Map(tails.map(tail => {
      const legs = journeyLegs(tail);
      return [tail, { score: score(tail), identities: new Set(legs.map(leg => identity(leg.route))), path: legs.map(leg => identity(leg.route) + '-' + leg.route.bound).join('/') }] as const;
    }));
    const buckets = new Map<string, Journey[]>();
    for (const tail of tails) {
      const cell = `${Math.floor(tail.stop.lat / 0.003)},${Math.floor(tail.stop.lng / 0.003)}`;
      if (!buckets.has(cell)) buckets.set(cell, []);
      buckets.get(cell)!.push(tail);
    }
    const next: Journey[] = [];
    for (const [key, ordered] of grouped) {
      const route = routeMap.get(key)!;
      if (transfers === 2 && !ordered.some(stop => stop.pickup !== false && !restricted(stop) && distance(origin.lat, origin.lng, stop) <= 1000)) continue;
      const exits = new Map<number, { leg: Journey; meters: number }[]>();
      for (const exit of ordered) {
        if (exit.dropoff === false) continue;
        const x = Math.floor(exit.lat / 0.003), y = Math.floor(exit.lng / 0.003);
        const matches: { leg: Journey; meters: number }[] = [];
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          for (const tail of buckets.get(`${x + dx},${y + dy}`) || []) {
            if (metadata.get(tail)!.identities.has(identity(route))) continue;
            const walk = distance(exit.lat, exit.lng, tail.stop);
            if (walk > 200 || (restricted(exit) || restricted(tail.stop)) && exit.id !== tail.stop.id) continue;
            matches.push({ leg: tail, meters: walk });
          }
        }
        if (matches.length) exits.set(exit.seq, matches);
      }
      const suffixes = new Map<string, { exit: Stop; transfer: { leg: Journey; meters: number }; cost: number }[]>();
      for (const stop of [...ordered].reverse()) {
        if (stop.pickup !== false && (transfers !== 2 || !restricted(stop) && distance(origin.lat, origin.lng, stop) <= 1000)) {
          const options = [...suffixes.values()].map(choices => choices.find(value => value.exit.id !== stop.id)).filter((choice): choice is NonNullable<typeof choice> => !!choice).sort((a, b) => Number(preferred(b.transfer.leg)) - Number(preferred(a.transfer.leg)) || a.cost - b.cost);
          for (const choice of includeTwo ? options.slice(0, 8) : options) {
            const candidate: Journey = { route, stop, alight: choice.exit, meters: 0, endMeters: choice.transfer.leg.endMeters, nearby: true, transfer: choice.transfer };
            next.push(candidate);
          }
        }
        for (const transfer of exits.get(stop.seq) || []) {
          const path = metadata.get(transfer.leg)!.path;
          const cost = stop.seq * 80 + metadata.get(transfer.leg)!.score + transfer.meters * 3;
          const choices = suffixes.get(path) || [];
          const value = { exit: stop, transfer, cost };
          const combined = [...choices, value].sort((a, b) => a.cost - b.cost);
          const unique = combined.filter((option, index) => combined.findIndex(other => other.exit.id === option.exit.id) === index).slice(0, 2);
          suffixes.set(path, unique);
        }
      }
    }
    const reachable = new Map<string, Journey>();
    for (const tail of next) {
      const meters = distance(origin.lat, origin.lng, tail.stop);
      if (restricted(tail.stop) || meters > 1000) continue;
      const candidate = { ...tail, meters };
      const key = journeyLegs(candidate).map(leg => identity(leg.route) + '-' + leg.route.bound).join('/');
      const previous = reachable.get(key);
      if (!previous || meters + score(candidate) < previous.meters + score(previous)) reachable.set(key, candidate);
    }
    if (reachable.size) {
      const options = [...reachable.values()].sort((a, b) => Number(preferred(b)) - Number(preferred(a)) || a.meters + score(a) - b.meters - score(b)).slice(0, 12);
      if (!includeTwo) return options;
      alternatives.push(...options);
    }
    tails = next;
  }
  return alternatives;
}
