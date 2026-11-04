import { useEffect, useRef, useState } from 'react';
import { MapPin, Search, Star } from 'lucide-react';
import { arrivalLabel, arrivalsFor, companyName, routeDescription, favouriteKey, noArrivalMessage, routeKey, type Arrival, type Favourite, type Route } from '../lib/bus';
import { currentPlace, directJourneys, transferJourneys, journeyGraph, schoolPlace, schoolStopIds, searchPlaces, type Journey, type Place } from '../lib/journey';

function PlaceInput({ label, value, onChange }: { label: string; value: Place | null; onChange: (place: Place | null) => void }) {
  const [text, setText] = useState(value?.name || '');
  const [matches, setMatches] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => { if (value) setText(value.name); }, [value]);
  useEffect(() => () => request.current?.abort(), []);
  async function lookup() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setMatches([]);
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
    <label className="journey-field"><span>{label}</span><input aria-label={label + '位置'} value={text} placeholder="輸入地點、地址或車站名稱" onChange={event => { request.current?.abort(); setBusy(false); setText(event.target.value); setMatches([]); setError(''); onChange(null); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void lookup(); } }} /></label>
    <button className="text-button" disabled={busy || !text.trim()} onClick={() => void lookup()}>{busy ? '正在查詢…' : '尋找' + label}</button>
    {value && <p className="place-selected">✓ 已選：{value.name}{value.detail ? ' · ' + value.detail : ''}</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {!!matches.length && <div className="place-options" aria-label={label + '地點選擇'}>{matches.map((place, index) => <button key={place.name + index} onClick={() => { onChange(place); setText(place.name); setMatches([]); }}><strong>{place.name}</strong><small>{place.detail || '香港'}</small></button>)}</div>}
  </div>;
}

type TimedJourney = Journey & { arrivals: Arrival[]; updated: number; error: boolean; secondArrivals?: Arrival[] };
export function sortJourneys(rows: TimedJourney[], now: number) {
  const first = (row: TimedJourney) => Math.min(...row.arrivals.filter(arrival => arrival.eta && Date.parse(arrival.eta) > now - 60000).map(arrival => Date.parse(arrival.eta!)));
  return [...rows].sort((a, b) => Number(b.nearby) - Number(a.nearby) || first(a) - first(b) || a.meters - b.meters || a.route.route.localeCompare(b.route.route, 'en', { numeric: true }));
}
const journeyKey = (journey: Journey) => routeKey(journey.route) + '-' + journey.stop.id + '-' + journey.stop.seq + '-' + journey.alight.id + '-' + journey.alight.seq + (journey.transfer ? '/' + routeKey(journey.transfer.leg.route) + '-' + journey.transfer.leg.stop.id + '-' + journey.transfer.leg.stop.seq + '-' + journey.transfer.leg.alight.id : '');

function JourneyResults({ journeys, school, refreshing, onRefresh, favourites, onToggleFavourite, onSelect }: { journeys: Journey[]; school: boolean; refreshing: boolean; onRefresh: () => Promise<void>; favourites: Favourite[]; onToggleFavourite: (favourite: Favourite) => void; onSelect: (favourite: Favourite) => void }) {
  const [rows, setRows] = useState<TimedJourney[]>([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [due, setDue] = useState(0);
  useEffect(() => {
    let cancelled = false, running = false, next = 0;
    const retryDeadline = Date.now() + 30000;
    let saved: TimedJourney[] = journeys.map(journey => ({ ...journey, arrivals: [], updated: 0, error: false }));
    setRows(saved);
    async function refresh() {
      if (cancelled || running) return;
      running = true; setBusy(true);
      let failed = false;
      try {
        const updated = new Map<string, TimedJourney>();
        for (let offset = 0; offset < journeys.length; offset += 5) {
          const results = await Promise.all(journeys.slice(offset, offset + 5).map(async journey => {
            try {
              const [arrivals, secondArrivals] = await Promise.all([arrivalsFor(journey.route, journey.stop), journey.transfer ? arrivalsFor(journey.transfer.leg.route, journey.transfer.leg.stop) : Promise.resolve(undefined)]);
              return { ...journey, arrivals, secondArrivals, updated: Date.now(), error: false };
            }
            catch {
              failed = true;
              const old = saved.find(row => journeyKey(row) === journeyKey(journey));
              return { ...journey, arrivals: old?.arrivals || [], secondArrivals: old?.secondArrivals, updated: old?.updated || 0, error: true };
            }
          }));
          if (cancelled) return;
          results.forEach(row => updated.set(journeyKey(row), row));
          setRows(saved.map(row => updated.get(journeyKey(row)) || row));
        }
        saved = saved.map(row => updated.get(journeyKey(row)) || row);
      } finally {
        running = false;
        next = Date.now() + (failed && Date.now() + 5000 <= retryDeadline ? 5000 : 30000);
        if (!cancelled) { setRows(saved); setNow(Date.now()); setDue(next); setBusy(false); }
      }
    }
    void refresh();
    const timer = setInterval(() => { setNow(Date.now()); if (next && Date.now() >= next && document.visibilityState === 'visible') void refresh(); }, 1000);
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', resume); document.addEventListener('visibilitychange', resume);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); };
  }, [journeys]);
  const display = sortJourneys(rows, now);
  return <div className="journey-results">
    <div className="nearby-refresh"><span role="timer">{busy || refreshing ? '正在更新資料…' : '下次更新：' + Math.max(0, Math.ceil((due - now) / 1000)) + ' 秒'}</span><button className="primary-button" disabled={busy || refreshing} onClick={() => void onRefresh()}>立即更新</button></div>
    {rows.some(row => row.error) && <p className="data-warning" role="alert">部分到站資料未能更新；有舊資料的路線會保留上次預報，請留意時間。</p>}
    {display.map((row, index) => {
      const saved = favourites.some(favourite => favouriteKey(favourite) === favouriteKey(row));
      const arrivals = row.arrivals.filter(arrival => arrival.eta && Date.parse(arrival.eta) > now - 60000).slice(0, 3);
      const stale = !!row.updated && (row.error || now - row.updated > 90000);
      return <div key={journeyKey(row)}>
        {school && (index === 0 || display[index - 1].nearby !== row.nearby) && <h3 className="journey-group">{row.nearby ? '由你附近出發 · 最快到站優先' : '其他可到校路線 · 最快到站優先'}</h3>}
        <article className="arrival-choice"><button className="route-card" onClick={() => onSelect(row)}>
          <span className={"route-number " + row.route.company.toLowerCase()}>{row.route.route}</span>
          <span className="route-body"><strong>{row.transfer ? "第一程 · " : ""}往 {row.route.to}</strong><small className="route-company">{companyName(row.route.company)} · {routeDescription(row.route)}</small><span className="route-origin">上車：{row.stop.name}{Number.isFinite(row.meters) ? ' · 約 ' + Math.round(row.meters) + ' 米（直線）' : ''}</span><span className="route-origin">落車：{row.alight.name}{!row.transfer && ' · 距目的地約 ' + Math.round(row.endMeters) + ' 米（直線）'}</span>{row.route.company !== 'GMB' && row.route.service !== '1' && <small className="route-company">特別班次 {row.route.service}</small>}<small className={stale || row.error ? 'data-warning' : 'route-company'}>{row.updated ? '上次成功更新 ' + new Date(row.updated).toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false }) + (stale ? ' · 舊資料，請更新後確認' : '') : row.error ? '到站資料未能取得' : '正在查詢到站時間…'}</small></span>
          <span className="nearby-times">{arrivals.length ? arrivals.map((arrival, i) => <span key={i}><small>{['下一班', '第二班', '第三班'][i]}</small><strong>{arrivalLabel(arrival.eta, now)}</strong></span>) : <strong>{row.error ? '查詢失敗' : !row.updated ? '查詢中…' : noArrivalMessage(row.arrivals)}</strong>}</span>
        </button><button className={'icon-button quick-save ' + (saved ? 'saved' : '')} aria-label={(saved ? '取消收藏' : '收藏') + row.route.route + ' ' + row.stop.name} onClick={() => onToggleFavourite(row)}><Star size={18} fill={saved ? 'currentColor' : 'none'} /></button></article>
        {row.transfer && <div className="transfer-leg">
          <p className="transfer-walk">轉車：{row.alight.name} → {row.transfer.leg.stop.name} · 約 {Math.round(row.transfer.meters)} 米（直線）</p>
          <button className="route-card" onClick={() => onSelect(row.transfer!.leg)}>
            <span className={'route-number ' + row.transfer.leg.route.company.toLowerCase()}>{row.transfer.leg.route.route}</span>
            <span className="route-body"><strong>第二程 · 往 {row.transfer.leg.route.to}</strong><small>{companyName(row.transfer.leg.route.company)} · {routeDescription(row.transfer.leg.route)}</small><span className="route-origin">上車：{row.transfer.leg.stop.name}</span><span className="route-origin">落車：{row.transfer.leg.alight.name} · 距目的地約 {Math.round(row.endMeters)} 米（直線）</span><small className={stale || row.error ? 'data-warning' : 'route-company'}>{row.error ? '更新失敗，請留意舊資料' : '以下為轉車站目前預報，並非你抵達後的班次'}</small></span>
            <span className="nearby-times">{row.secondArrivals?.filter(arrival => arrival.eta && Date.parse(arrival.eta) > now - 60000).slice(0, 3).map((arrival, i) => <span key={i}><small>{['下一班', '第二班', '第三班'][i]}</small><strong>{arrivalLabel(arrival.eta, now)}</strong></span>)}{!row.secondArrivals?.some(arrival => arrival.eta && Date.parse(arrival.eta) > now - 60000) && <strong>{row.error ? '查詢失敗' : !row.updated ? '查詢中…' : noArrivalMessage(row.secondArrivals || [])}</strong>}</span>
          </button>
        </div>}
      </div>;
    })}
    {!journeys.length && <p className="empty-message">{school ? '未找到可到學校附近的直達路線。' : '指定範圍內未找到直達或轉一次車的方案，請改選起點或目的地。'}</p>}
    <p className="list-note">{school ? '附近出發指上車站距起點 1 公里內；其餘路線另列下方。落車站為可風中學門口或對面車站。' : '上車站距起點最多 1 公里，落車站距目的地最多 400 米（直線）。'}距離為直線估算，實際步行路徑可能較遠。最快到站不代表最快抵達目的地。</p>
  </div>;
}

export default function JourneyPlanner({ school = false, routes, loadingRoutes, position, favourites, onToggleFavourite, onSelect }: { school?: boolean; routes: Route[]; loadingRoutes: boolean; position: { lat: number; lng: number } | null; favourites: Favourite[]; onToggleFavourite: (favourite: Favourite) => void; onSelect: (favourite: Favourite) => void }) {
  const [useGps, setUseGps] = useState(true);
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(school ? schoolPlace : null);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [snapshot, setSnapshot] = useState('');
  const [revision, setRevision] = useState(0);
  const requestId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestId.current++; }; }, []);
  async function find(refreshGps = false) {
    const id = ++requestId.current;
    if (!destination) { setError('請先尋找並選擇目的地。'); return; }
    setBusy(true); setError('');
    try {
      let start = origin;
      if (useGps) {
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
      if (!school && !start) throw new Error('請先尋找並選擇起點。');
      if (!routes.some(route => route.company === 'KMB')) throw new Error('九巴／龍運路線資料未能載入，請稍後重試。');
      const graph = await journeyGraph();
      let result = directJourneys(routes, graph.stops, graph.rows, start, destination, school, school ? schoolStopIds : undefined);
      if (!result.length && start) result = transferJourneys(routes, graph.stops, graph.rows, start, destination, school ? schoolStopIds : undefined);
      if (mounted.current && id === requestId.current) {
        setJourneys(result); setSnapshot(graph.snapshotAt); setSearched(true);
      }
    } catch (error) {
      if (mounted.current && id === requestId.current) setError(error instanceof Error ? error.message : '未能搜尋路線，請重試。');
    } finally { if (mounted.current && id === requestId.current) setBusy(false); }
  }
  useEffect(() => {
    if (school && !loadingRoutes) void find(false);
  }, [school, loadingRoutes, routes, position, revision]);
  function clearResults() { requestId.current++; setSearched(false); setJourneys([]); setBusy(false); setError(''); }
  async function refresh() { await find(useGps); }
  return <section aria-label={school ? '返學啦' : '起點及目的地搜尋'} className="journey-planner">
    {school && <h2 className="journey-heading">返學啦 · 聖公會李炳中學</h2>}
    <div className="journey-form">
      <label className="gps-choice"><input type="checkbox" checked={useGps} onChange={event => { setUseGps(event.target.checked); clearResults(); }} /><MapPin size={17} />以目前位置為起點</label>
      {!useGps && <PlaceInput label="起點" value={origin} onChange={value => { setOrigin(value); clearResults(); }} />}
      {school ? <p className="school-destination">目的地：聖公會李炳中學</p> : <PlaceInput label="目的地" value={destination} onChange={value => { setDestination(value); clearResults(); }} />}
      <button className="primary-button" disabled={busy || loadingRoutes} onClick={() => { if (school) setRevision(value => value + 1); else void find(true); }}><Search size={16} />{busy ? '正在搜尋…' : '搜尋路線及轉車方案'}</button>
      <p className="list-note">配對九巴／龍運及綠色小巴；少量未有座標的小巴站不參與位置配對。沒有直達路線時顯示轉一次車的方案，最多列出 12 個。城巴可用路線搜尋。每條路線最多三班預報，按最快到上車站排序。</p>
    </div>
    {error && <p className="data-warning" role="alert">{error}<button className="text-button" disabled={busy || loadingRoutes} onClick={() => void find(true)}>重試</button></p>}
    {loadingRoutes && <p className="loading-message">正在載入路線資料…</p>}
    {busy && !searched && <p className="loading-message">正在配對上落車站…</p>}
    {searched && journeys.some(journey => journey.transfer) && <p className="data-warning">未找到直達路線，以下需轉一次車。按第一程最快到站排序；轉車距離為直線估算，請確認行人通道。第二程為目前預報，未計首程車程，不能保證銜接。</p>}
    {searched && <JourneyResults journeys={journeys} school={school} refreshing={busy} onRefresh={refresh} favourites={favourites} onToggleFavourite={onToggleFavourite} onSelect={onSelect} />}
    {snapshot && searched && <p className="list-note">路線及車站資料日期：{new Date(snapshot).toLocaleDateString('zh-HK', { timeZone: 'Asia/Hong_Kong' })} · 到站預報另行即時查詢</p>}
  </section>;
}
