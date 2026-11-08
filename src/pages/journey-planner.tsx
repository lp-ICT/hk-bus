import { useScreenActive } from '../lib/activity';
import { googleTransitUrl } from '../lib/google-directions';
import { usePageRefresh } from '../lib/page-refresh';
import { useEffect, useRef, useState } from 'react';
import { withJourneyTimes, estimateJourney, estimateClock, compareJourneyArrival, type TimedJourney } from '../lib/journey-time';
import { MapPin, Search, Star } from 'lucide-react';
import { arrivalLabel, arrivalsFor, companyName, routeDescription, favouriteKey, noArrivalMessage, routeKey, type Arrival, type Favourite, type Route } from '../lib/bus';
import { currentPlace, directJourneys, journeyLegs, journeyGraph, schoolPlace, schoolDestinationStops, searchPlaces, type Journey, type Place } from '../lib/journey';

export function PlaceInput({ label, value, onChange, onTextChange }: { label: string; value: Place | null; onChange: (place: Place | null) => void; onTextChange?: (text: string) => void }) {
  const active = useScreenActive();
  const [text, setText] = useState(value?.name || '');
  const [matches, setMatches] = useState<Place[]>([]);
  const [showAllPlaces, setShowAllPlaces] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => { if (value) setText(value.name); }, [value]);
  useEffect(() => {
    if (!active) { request.current?.abort(); setBusy(false); }
    return () => request.current?.abort();
  }, [active]);
  async function lookup() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setMatches([]); setShowAllPlaces(false);
    try {
      const results = await searchPlaces(text, controller.signal);
      if (!controller.signal.aborted) {
        setMatches(results);
        if (!results.length) setError('找不到地點，請輸入較完整的名稱或地址。');
      }
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '地點查詢失敗，請重試。'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <div className="journey-place">
    <div className="place-lookup-row"><label className="journey-field"><span>{label}</span><input aria-label={label + '位置'} value={text} placeholder="輸入地點、地址或車站名稱" onChange={event => { request.current?.abort(); setBusy(false); setText(event.target.value); onTextChange?.(event.target.value); setMatches([]); setError(''); onChange(null); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void lookup(); } }} /></label>
    <button className="place-lookup-button" disabled={busy || !text.trim()} onClick={() => void lookup()}>{busy ? '查詢中…' : '尋找' + label}</button></div>
    {value && <p className="place-selected">✓ 已選：{value.name}{value.detail ? ' · ' + value.detail : ''}</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {!!matches.length && <div className="place-options" aria-label={label + '地點選擇'}>{(showAllPlaces ? matches : matches.slice(0, 6)).map((place, index) => <button key={place.name + index} onClick={() => { onChange(place); setText(place.name); setMatches([]); }}><strong>{place.name}</strong><small>{place.detail || '香港'}</small></button>)}</div>}
    {matches.length > 6 && <button className="text-button" onClick={() => setShowAllPlaces(value => !value)}>{showAllPlaces ? '收起其他地點' : '顯示其他地點（' + (matches.length - 6) + '）'}</button>}
  </div>;
}

export function matchesSavedJourney(row: Journey, favourites: Favourite[], matchRouteDirection = false) {
  const normal = (value: string) => String(value).trim().toUpperCase();
  return journeyLegs(row).some(leg => favourites.some(f => matchRouteDirection
    ? normal(f.route.company) === normal(leg.route.company) && normal(f.route.route) === normal(leg.route.route) && normal(f.route.bound) === normal(leg.route.bound) && (leg.route.company !== 'GMB' || normal(f.route.service) === normal(leg.route.service))
    : favouriteKey(f) === favouriteKey(leg)));
}

export type RailPriority = 'none' | 'destination' | 'both';
export function railPriorityRank(row: Journey, priority: RailPriority) {
  const legs = journeyLegs(row);
  if (priority === 'both') return legs.every(leg => leg.route.company === 'MTR') ? 0 : 1;
  if (priority === 'destination') {
    if (legs.length === 1 && ['KMB', 'CTB', 'RESIDENT'].includes(row.route.company)) return 0;
    if (legs[1]?.route.company === 'MTR') return 1;
    return 2;
  }
  return 0;
}
export function sortJourneys(rows: TimedJourney[], now: number, favourites: Favourite[] = [], matchRouteDirection = false, railPriority: RailPriority = 'none') {
  const first = (row: TimedJourney) => Math.min(...row.arrivals.filter(arrival => arrival.eta && Date.parse(arrival.eta) > now - 60000).map(arrival => Date.parse(arrival.eta!)));
  const saved = (row: TimedJourney) => matchesSavedJourney(row, favourites, matchRouteDirection);
  return [...rows].sort((a, b) => railPriorityRank(a, railPriority) - railPriorityRank(b, railPriority) || compareJourneyArrival(a, b, now) || (estimateJourney(a, now).arrival === undefined && estimateJourney(b, now).arrival === undefined ? Number(!!a.transfer) - Number(!!b.transfer) : 0) || Number(saved(b)) - Number(saved(a)) || Number(!!a.transfer) - Number(!!b.transfer) || Number(b.nearby) - Number(a.nearby) || first(a) - first(b) || a.meters - b.meters || a.route.route.localeCompare(b.route.route, 'en', { numeric: true }));
}
const journeyKey = (journey: Journey) => journeyLegs(journey).map(leg => routeKey(leg.route) + '-' + leg.stop.id + '-' + leg.stop.seq + '-' + leg.alight.id + '-' + leg.alight.seq).join('/');

export function withoutRedundantTransfers<T extends Journey>(rows: T[]): T[] {
  const directRoutes = new Set(rows.filter(row => !row.transfer).map(row => routeKey(row.route)));
  return rows.filter(row => !row.transfer || !journeyLegs(row).some(leg => directRoutes.has(routeKey(leg.route))));
}

export function canCollapseTransfers(rows: Journey[]) {
  return new Set(rows.filter(row => !row.transfer).map(row => row.route.company + ':' + row.route.route)).size >= 2 && rows.some(row => !!row.transfer);
}

function JourneyResults({ journeys, school, refreshing, onRefresh, favourites, onToggleFavourite, onSelect, prioritiseFavourites, railPriority }: { railPriority: RailPriority; prioritiseFavourites: boolean; journeys: Journey[]; school: boolean; refreshing: boolean; onRefresh: () => Promise<void>; favourites: Favourite[]; onToggleFavourite: (favourite: Favourite) => void; onSelect: (favourite: Favourite) => void }) {
  const active = useScreenActive();
  const savedResults = useRef<{ journeys: Journey[]; rows: TimedJourney[] } | null>(null);
  const [rows, setRows] = useState<TimedJourney[]>([]);
  const [expandedJourneys, setExpandedJourneys] = useState<Journey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [due, setDue] = useState(0);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const controller = new AbortController();
    let cancelled = false, running = false, next = 0;
    const retryDeadline = Date.now() + 30000;
    let saved: TimedJourney[] = savedResults.current?.journeys === journeys ? savedResults.current.rows : journeys.map(journey => ({ ...journey, arrivals: [], updated: 0, error: false }));
    setRows(saved);
    async function refresh() {
      if (cancelled || running) return;
      running = true; setBusy(true);
      let failed = false;
      try {
        const updated = new Map<string, TimedJourney>();
        const forecasts = new Map<string, Promise<Arrival[]>>();
        const forecast = (leg: Journey) => {
          const key = favouriteKey(leg) + (leg.route.company === 'MTR' ? '-' + leg.alight.id : '');
          if (!forecasts.has(key)) forecasts.set(key, arrivalsFor(leg.route, leg.stop, leg.alight, controller.signal));
          return forecasts.get(key)!;
        };
        for (let offset = 0; offset < journeys.length; offset += 5) {
          const results = await Promise.all(journeys.slice(offset, offset + 5).map(async journey => {
            try {
              const legArrivals = await Promise.all(journeyLegs(journey).map(forecast));
              const [arrivals] = legArrivals;
              return { ...journey, arrivals, legArrivals, updated: Date.now(), error: false };
            }
            catch {
              failed = true;
              const old = saved.find(row => journeyKey(row) === journeyKey(journey));
              return { ...journey, arrivals: old?.arrivals || [], legArrivals: old?.legArrivals, updated: old?.updated || 0, error: true };
            }
          }));
          if (cancelled) return;
          results.forEach(row => updated.set(journeyKey(row), row));
          const partial = saved.map(row => updated.get(journeyKey(row)) || row);
          savedResults.current = { journeys, rows: partial };
          setRows(partial);
        }
        saved = saved.map(row => updated.get(journeyKey(row)) || row);
        savedResults.current = { journeys, rows: saved };
      } finally {
        running = false;
        next = Date.now() + (failed && Date.now() + 5000 <= retryDeadline ? 5000 : 30000);
        if (!cancelled) { setRows(saved); setNow(Date.now()); setDue(next); setBusy(false); }
      }
    }
    void refresh();
    const timer = setInterval(() => { setNow(Date.now()); if (next && Date.now() >= next && document.visibilityState === 'visible') void refresh(); }, 1000);
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', resume);
    return () => { cancelled = true; controller.abort(); clearInterval(timer); window.removeEventListener('online', resume); };
  }, [journeys, active]);
  const display = sortJourneys(withoutRedundantTransfers(rows), now, prioritiseFavourites ? favourites : [], school, railPriority);
  const collapseTransfers = canCollapseTransfers(display);
  const showTransfers = !collapseTransfers || expandedJourneys === journeys;
  const visibleRows = showTransfers ? display : display.filter(row => !row.transfer);
  return <div className="journey-results">
    <div className="nearby-refresh"><span role="timer">{busy || refreshing ? '正在更新資料…' : '下次更新：' + Math.max(0, Math.ceil((due - now) / 1000)) + ' 秒'}</span><button className="primary-button" disabled={busy || refreshing} onClick={() => void onRefresh()}>立即更新</button></div>
    {school ? <details className="journey-help"><summary>排序說明 ⓘ</summary><p className="station-caption">按預計最快抵達目的地排序；抵達時間相同時，收藏路線優先。未能估算的方案排後。</p></details> : <p className="station-caption">按預計最快抵達目的地排序；抵達時間相同時，收藏路線優先。未能估算的方案排後。</p>}
    {railPriority !== 'none' && <p className="station-caption">{railPriority === 'both' ? '起點及目的地均為港鐵站：港鐵方案優先。' : '目的地為港鐵站：直達巴士優先，其次為第二程乘港鐵的方案。'}各組內按預計最快抵達排序。</p>}
    {rows.some(row => row.error) && <p className="data-warning" role="alert">部分到站資料未能更新；有舊資料的路線會保留上次預報，請留意時間。</p>}
    {collapseTransfers && <button className="primary-button" aria-expanded={showTransfers} onClick={() => setExpandedJourneys(showTransfers ? null : journeys)}>{showTransfers ? '隱藏轉車方案' : '顯示轉車方案'}（{journeys.filter(row => row.transfer).length}）</button>}
    {visibleRows.map(row => {
      const saved = favourites.some(favourite => favouriteKey(favourite) === favouriteKey(row));
      const arrivals = row.arrivals.filter(arrival => arrival.eta && Date.parse(arrival.eta) > now - 60000).slice(0, 3);
      const estimate = estimateJourney(row, now);
      const stale = !!row.updated && (row.error || now - row.updated > 90000);
      return <div key={journeyKey(row)}>
        <h3 className="journey-group">{row.transfer ? '轉車方案' : '直達方案 · 毋須轉車'}</h3>
        <div className="journey-estimate" aria-label="預計抵達目的地">{journeyLegs(row).some(leg => leg.route.company === 'RESIDENT') && <p className="data-warning">此方案含居民巴士，未確認目前有班次；請先查看各程官方時間表。</p>}
          {prioritiseFavourites && matchesSavedJourney(row, favourites, school) && <strong>★ 已收藏</strong>}
          <strong>{estimate.arrival !== undefined ? '預計抵達約 ' + estimateClock(estimate.arrival) : '預計抵達：未能估算'}</strong>
          <span>{estimate.arrival !== undefined ? '全程約 ' + Math.ceil((estimate.arrival - now) / 60000) + ' 分鐘' : estimate.reason}</span>
          {estimate.arrival !== undefined && <details><summary>估算詳情</summary><p>步行約 {Math.ceil(estimate.walking)} 分鐘 · 候車及轉車緩衝約 {Math.ceil(estimate.waiting)} 分鐘 · 車程約 {Math.ceil(estimate.riding)} 分鐘</p>{estimate.legs.map((leg, i) => <p key={i}>第{i + 1}程：約 {estimateClock(leg.boarding)} 上車 → {estimateClock(leg.alighting)} 落車</p>)}</details>}
        </div>
        <article className="arrival-choice"><button className="route-card" onClick={() => onSelect(row)}>
          <span className={"route-number " + row.route.company.toLowerCase()}>{row.route.route}</span>
          <span className="route-body"><strong>{row.transfer ? "第一程 · " : ""}往 {row.route.to}</strong><small className="route-company">{companyName(row.route.company)} · {routeDescription(row.route)}</small><span className="route-origin">上車：{row.stop.name}{Number.isFinite(row.meters) ? ' · 步行約 ' + Math.round(row.meters) + ' 米（直線）' : ''}</span><span className="route-origin">落車：{row.alight.name}{!row.transfer && ' · 步行至目的地約 ' + Math.round(row.endMeters) + ' 米（直線）'}</span>{row.route.company !== 'GMB' && row.route.company !== 'MTR' && row.route.service !== '1' && <small className="route-company">特別班次 {row.route.service}</small>}<small className={stale || row.error ? 'data-warning' : 'route-company'}>{row.updated ? '上次成功更新 ' + new Date(row.updated).toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false }) + (stale ? ' · 舊資料，請更新後確認' : '') : row.error ? '到站資料未能取得' : '正在查詢到站時間…'}</small></span>
          <span className="nearby-times">{arrivals.length ? arrivals.map((arrival, i) => <span key={i}><small>{['下一班', '第二班', '第三班'][i]}</small><strong>{arrivalLabel(arrival.eta, now)}</strong>{row.route.company === 'MTR' && <small>{arrival.remark}</small>}</span>) : <strong>{row.error ? '查詢失敗' : !row.updated ? '查詢中…' : noArrivalMessage(row.arrivals)}</strong>}</span>
        </button><button className={'icon-button quick-save ' + (saved ? 'saved' : '')} aria-label={(saved ? '取消收藏' : '收藏') + row.route.route + ' ' + row.stop.name} onClick={() => onToggleFavourite(row)}><Star size={18} fill={saved ? 'currentColor' : 'none'} /></button></article>
        {journeyLegs(row).slice(1).map((leg, legIndex) => {
          const previous = journeyLegs(row)[legIndex];
          const times = row.legArrivals?.[legIndex + 1] || [];
          const upcoming = times.filter(arrival => arrival.eta && Date.parse(arrival.eta) > now - 60000).slice(0, 3);
          return <div className="transfer-leg" key={journeyKey(leg)}>
            <p className="transfer-walk">步行接駁：{previous.alight.name} → {leg.stop.name} · 約 {Math.round(previous.transfer!.meters)} 米（直線，請確認行人通道）</p>
            <button className="route-card" onClick={() => onSelect(leg)}>
              <span className={'route-number ' + leg.route.company.toLowerCase()}>{leg.route.route}</span>
              <span className="route-body"><strong>第{legIndex + 2}程 · 往 {leg.route.to}</strong><small>{companyName(leg.route.company)} · {routeDescription(leg.route)}</small><span className="route-origin">上車：{leg.stop.name}</span><span className="route-origin">落車：{leg.alight.name}{!leg.transfer && ' · 步行至目的地約 ' + Math.round(row.endMeters) + ' 米（直線）'}</span><small className={stale || row.error ? 'data-warning' : 'route-company'}>{row.error ? '更新失敗，請留意舊資料' : '轉車站目前預報，並非你抵達後的班次'}</small></span>
              <span className="nearby-times">{upcoming.length ? upcoming.map((arrival, i) => <span key={i}><small>{['下一班', '第二班', '第三班'][i]}</small><strong>{arrivalLabel(arrival.eta, now)}</strong>{leg.route.company === 'MTR' && <small>{arrival.remark}</small>}</span>) : <strong>{row.error ? '查詢失敗' : !row.updated ? '查詢中…' : noArrivalMessage(times)}</strong>}</span>
            </button>
          </div>;
        })}
      </div>;
    })}
    {!journeys.length && <p className="empty-message">{'指定範圍內未找到直達或最多轉兩次車的方案，請改選起點或目的地。'}</p>}
    {school ? <details className="journey-help"><summary>估算方法及資料來源 ⓘ</summary><p className="list-note"><a href="https://data.gov.hk/tc-data/dataset/hk-td-tis_23-routes-fares-geojson" target="_blank" rel="noreferrer">參考車程來源：運輸署</a>。{school ? '有起點時只配對 1 公里內上車的方案；無定位時僅列所有直達路線。落車站為可風中學門口、對面巴士站或學校附近小巴站。' : '上車站距起點最多 1 公里，落車站距目的地最多 400 米（直線）。'}距離為直線估算，實際步行路徑可能較遠。抵達時間為估算，按運輸署全程參考車程分攤所搭路段；步行按每小時 4.5 公里及直線距離乘 1.3，一般轉車預留 2 分鐘；港鐵首次入站另加 3 分鐘、轉乘入站或轉綫另加 5 分鐘。港鐵車程按站距（乘 1.2）、每小時 35 公里及每站 45 秒粗略估算，並非港鐵官方行車時間。未計即時塞車及真實行人路線，不能保證銜接；缺資料的方案在所屬組內排後。候選搜尋不保證涵蓋所有路線。</p></details> : <p className="list-note"><a href="https://data.gov.hk/tc-data/dataset/hk-td-tis_23-routes-fares-geojson" target="_blank" rel="noreferrer">參考車程來源：運輸署</a>。{school ? '有起點時只配對 1 公里內上車的方案；無定位時僅列所有直達路線。落車站為可風中學門口、對面巴士站或學校附近小巴站。' : '上車站距起點最多 1 公里，落車站距目的地最多 400 米（直線）。'}距離為直線估算，實際步行路徑可能較遠。抵達時間為估算，按運輸署全程參考車程分攤所搭路段；步行按每小時 4.5 公里及直線距離乘 1.3，一般轉車預留 2 分鐘；港鐵首次入站另加 3 分鐘、轉乘入站或轉綫另加 5 分鐘。港鐵車程按站距（乘 1.2）、每小時 35 公里及每站 45 秒粗略估算，並非港鐵官方行車時間。未計即時塞車及真實行人路線，不能保證銜接；缺資料的方案在所屬組內排後。候選搜尋不保證涵蓋所有路線。</p>}
  </div>;
}

export default function JourneyPlanner({ school = false, fromSchool = false, routes, loadingRoutes, position, favourites, onToggleFavourite, onSelect }: { school?: boolean; fromSchool?: boolean; routes: Route[]; loadingRoutes: boolean; position: { lat: number; lng: number } | null; favourites: Favourite[]; onToggleFavourite: (favourite: Favourite) => void; onSelect: (favourite: Favourite) => void }) {
  const active = useScreenActive();
  const [useGps, setUseGps] = useState(true);
  const [transport, setTransport] = useState<'all' | Route['company']>('all');
  const [origin, setOrigin] = useState<Place | null>(null);
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [destination, setDestination] = useState<Place | null>(school ? schoolPlace : null);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [railPriority, setRailPriority] = useState<RailPriority>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [snapshot, setSnapshot] = useState('');
  const [revision, setRevision] = useState(0);
  const worker = useRef<Worker | null>(null);
  const stopWorker = useRef<(() => void) | null>(null);
  const requestId = useRef(0);
  const pendingFind = useRef(false);
  const wasActive = useRef(active);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestId.current++; stopWorker.current?.(); }; }, []);
  async function find(refreshGps = false) {
    stopWorker.current?.();
    const id = ++requestId.current;
    if (!destination) { setError('請先尋找並選擇目的地。'); return; }
    pendingFind.current = true;
    setBusy(true); setError('');
    try {
      let start = fromSchool ? schoolPlace : origin;
      if (useGps && !fromSchool) {
        if (!refreshGps && position) start = { ...position, name: '目前位置' };
        else {
          try { start = await currentPlace(); }
          catch (error) {
            if (!school) throw error;
            start = null;
            if (mounted.current && id === requestId.current) setError('未能取得位置，先列出所有可到校路線；你亦可輸入起點再搜尋。');
          }
        }
      }
      if (!mounted.current || id !== requestId.current) return;
      if (!school && !start) throw new Error('請先尋找並選擇起點。');
      if (!routes.some(route => route.company !== 'CTB')) throw new Error('交通路線資料未能載入，請稍後重試。');
      const graph = await journeyGraph();
      if (!mounted.current || id !== requestId.current) return;
      const selectedRoutes = routes.filter(route => transport === 'all' || route.company === transport);
      const destinationIds = school ? schoolDestinationStops(graph.stops) : undefined;
      const result = start ? await new Promise<Journey[]>((resolve, reject) => {
        const task = new Worker(new URL('../lib/journey-worker.ts', import.meta.url));
        worker.current = task;
        const finish = () => { clearTimeout(timer); task.terminate(); if (worker.current === task) { worker.current = null; stopWorker.current = null; } };
        const timer = setTimeout(() => { finish(); reject(new Error('行程配對逾時，請改選較接近的起點或目的地。')); }, 30000);
        stopWorker.current = () => { finish(); reject(new Error('搜尋已取消')); };
        task.onmessage = event => { finish(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.journeys); };
        task.onerror = () => { finish(); reject(new Error('未能配對行程，請重試。')); };
        task.postMessage({ routes: selectedRoutes, stops: graph.stops, rows: graph.rows, origin: start, destination, alightingIds: destinationIds, preferredRoutes: school ? favourites.map(f => f.route) : [], times: graph.times });
      }) : directJourneys(selectedRoutes, graph.stops, graph.rows, null, destination, true, destinationIds).map(journey => withJourneyTimes(journey, graph.times));
      if (mounted.current && id === requestId.current) {
        setRailPriority(destination.detail?.startsWith('港鐵站') ? start?.detail?.startsWith('港鐵站') ? 'both' : 'destination' : 'none');
        setJourneys(result); setSnapshot(graph.snapshotAt); setSearched(true);
      }
    } catch (error) {
      if (mounted.current && id === requestId.current) setError(error instanceof Error ? error.message : '未能搜尋路線，請重試。');
    } finally { if (mounted.current && id === requestId.current) { pendingFind.current = false; setBusy(false); } }
  }
  useEffect(() => {
    if (active && school && !loadingRoutes) void find(false);
  }, [school, loadingRoutes, routes, position, revision, transport]);
  useEffect(() => {
    if (!active) { requestId.current++; stopWorker.current?.(); setBusy(false); }
    else if (!wasActive.current && (pendingFind.current || school && !searched) && !loadingRoutes) void find(false);
    wasActive.current = active;
  }, [active]);
  function clearResults() { pendingFind.current = false; requestId.current++; stopWorker.current?.(); setSearched(false); setJourneys([]); setBusy(false); setError(''); }
  async function refresh() { await find(useGps); }
  usePageRefresh(async () => { if (!busy && (searched || school)) await find(false); });
  const mapsOrigin = fromSchool ? schoolPlace : useGps ? position ? { ...position, name: '目前位置' } : null : origin || originText;
  const mapsDestination = school ? schoolPlace : destination || destinationText;
  const mapsUrl = (fromSchool || useGps || origin || originText.trim()) ? googleTransitUrl(mapsOrigin, mapsDestination) : undefined;
  return <section aria-label={school ? '返學啦' : '起點及目的地搜尋'} className="journey-planner">
    {school && <h2 className="journey-heading">返學啦 · 聖公會李炳中學</h2>}
    <div className="journey-form">
      {!fromSchool && <label className="gps-choice"><input type="checkbox" checked={useGps} onChange={event => { setUseGps(event.target.checked); clearResults(); }} /><MapPin size={17} />以目前位置為起點</label>}
      {fromSchool && <p className="school-destination">起點：聖公會李炳中學</p>}
      {!fromSchool && !useGps && <PlaceInput label="起點" value={origin} onTextChange={setOriginText} onChange={value => { setOrigin(value); clearResults(); }} />}
      {school ? <p className="school-destination">目的地：聖公會李炳中學</p> : <PlaceInput label="目的地" value={destination} onTextChange={setDestinationText} onChange={value => { setDestination(value); clearResults(); }} />}
      <div className="filter-row" aria-label="行程交通工具">{([{ id: 'all', name: '全部交通' }, { id: 'KMB', name: '九巴 / 龍運' }, { id: 'CTB', name: '城巴（暫未支援行程配對）' }, { id: 'RESIDENT', name: '居民巴士' }, { id: 'GMB', name: '綠色小巴' }, { id: 'MTR', name: '港鐵' }] as const).filter(option => !school || option.id === 'all' || option.id === 'KMB' || option.id === 'GMB').map(option => <button key={option.id} disabled={option.id === 'CTB'} aria-pressed={transport === option.id} className={transport === option.id ? 'chosen' : ''} onClick={() => { clearResults(); setTransport(option.id); }}>{school && option.id === 'GMB' ? '小巴' : option.name}</button>)}</div>
      {!school && <p className="list-note">全部交通可混合轉車；選擇個別類別後，所有車程只使用該類交通工具。Google 地圖另行提供公共交通方案，不套用此篩選。</p>}
      <div className="journey-actions">
        <button className="primary-button journey-search-button" disabled={busy || loadingRoutes} onClick={() => { if (school) setRevision(value => value + 1); else void find(true); }}><Search size={18} />{busy ? '正在搜尋…' : '搜尋路線'}</button>
        {mapsUrl ? <a className="primary-button journey-google-button" href={mapsUrl} target="_blank" rel="noopener noreferrer"><MapPin size={15} />Google 地圖</a> : <button className="primary-button journey-google-button" disabled><MapPin size={15} />Google 地圖</button>}
      </div>
      {!school && <p className="list-note">{!mapsUrl ? '請先輸入' + (!fromSchool && !useGps ? '起點及' : '') + '目的地。' : '開啟 Google 地圖，以公共交通規劃行程及步行接駁；起點及目的地會傳送給 Google。'}{useGps && !fromSchool && !position && ' Google 地圖會嘗試取得目前位置；無法定位時可自行選擇起點。'}</p>}
      {school ? <details className="journey-help"><summary>使用說明 ⓘ</summary><p className="list-note">全部交通可混合轉車；選擇個別類別後，所有車程只使用該類交通工具。Google 地圖另行提供公共交通方案，不套用此篩選。</p><p className="list-note">{!mapsUrl ? '請先輸入' + (!fromSchool && !useGps ? '起點及' : '') + '目的地。' : '開啟 Google 地圖，以公共交通規劃行程及步行接駁；起點及目的地會傳送給 Google。'}{useGps && !fromSchool && !position && ' Google 地圖會嘗試取得目前位置；無法定位時可自行選擇起點。'}</p><p className="list-note">配對九巴／龍運、綠色小巴、港鐵及已收錄居民巴士；居民巴士未有即時預報，請核對官方時間表及服務時段。比較直達及最多轉兩次車的候選方案，每種轉車次數最多列出 12 個。城巴可用路線搜尋。每條路線最多三班預報，按預計最快抵達目的地排序，資料不足的方案排後。</p></details> : <p className="list-note">配對九巴／龍運、綠色小巴、港鐵及已收錄居民巴士；居民巴士未有即時預報，請核對官方時間表及服務時段。比較直達及最多轉兩次車的候選方案，每種轉車次數最多列出 12 個。城巴可用路線搜尋。每條路線最多三班預報，按預計最快抵達目的地排序，資料不足的方案排後。</p>}
    </div>
    {error && <p className="data-warning" role="alert">{error}<button className="text-button" disabled={busy || loadingRoutes} onClick={() => void find(true)}>重試</button></p>}
    {loadingRoutes && <p className="loading-message">正在載入路線資料…</p>}
    {busy && !searched && <p className="loading-message">正在配對上落車站…</p>}
    {searched && journeys.some(journey => journey.transfer) && <p className="data-warning">以下包括轉車候選方案（最多兩次）。按預計抵達目的地排序；轉車距離為直線估算，一般最多 200 米、涉及港鐵最多 400 米；中環／香港及尖沙咀／尖東另按已知站內連接處理。請確認行人通道。後續各程仍顯示車站目前預報；估算只選步行及前段車程後可接駁的預報，不能保證銜接。</p>}
    {searched && <JourneyResults railPriority={railPriority} journeys={journeys} school={school} prioritiseFavourites={true} refreshing={busy} onRefresh={refresh} favourites={favourites} onToggleFavourite={onToggleFavourite} onSelect={onSelect} />}
    {snapshot && searched && <p className="list-note">路線及車站資料日期：{new Date(snapshot).toLocaleDateString('zh-HK', { timeZone: 'Asia/Hong_Kong' })} · 到站預報另行即時查詢</p>}
  </section>;
}
