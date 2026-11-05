import { useEffect, useState } from 'react';
import { ChevronRight, MapPin, RefreshCw } from 'lucide-react';
import { allTransitStops, favouriteKey, companyName, routesAtStop, searchStops, type Favourite, type Route, type Stop } from '../lib/bus';

export default function StopSearch({ query, routes, loadingRoutes, onSelect }: { query: string; routes: Route[]; loadingRoutes: boolean; onSelect: (value: Favourite) => void }) {
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [chosen, setChosen] = useState<Stop | null>(null);
  const [results, setResults] = useState<Favourite[]>([]);
  const [busy, setBusy] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [routeRetry, setRouteRetry] = useState(0);
  const [limit, setLimit] = useState(20);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    allTransitStops().then(value => { if (active) setStops(value); })
      .catch(() => { if (active) setError('未能載入車站資料，請檢查網絡後重試。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);
  useEffect(() => { setChosen(null); setLimit(20); }, [query]);
  useEffect(() => {
    let active = true;
    setResults([]); setRouteError('');
    if (!chosen || loadingRoutes) { setBusy(false); return; }
    setBusy(true);
    routesAtStop(chosen.id, routes).then(value => { if (active) setResults(value); })
      .catch(() => { if (active) setRouteError('未能載入途經路線，請重試。'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [chosen, routes, loadingRoutes, routeRetry]);
  const matches = searchStops(stops, query);
  return <section aria-label="車站及地點搜尋結果">
    <div className="section-label"><span>車站／地點搜尋</span><span>{loading ? '載入中' : `${matches.length} 個車站`}</span></div>
    <p className="list-note">按車站名稱搜尋九巴／龍運、綠色小巴及港鐵途經路線；地點會配對名稱含該地點的車站。同名車站可能分屬不同方向，請選站後確認目的地。</p>
    {loading && <p className="loading-message"><RefreshCw size={17} className="spin" />正在載入車站…</p>}
    {error && <div className="inline-error" role="alert">{error}<button onClick={() => setRetry(value => value + 1)}>重試</button></div>}
    {!loading && !error && !matches.length && <p className="empty-message">找不到相符車站，試試較短的地點或車站名稱。</p>}
    {chosen && <div className="near-routes"><div className="section-label"><span>{chosen.name} · 途經路線</span><button className="text-button" onClick={() => setChosen(null)}>收起</button></div>
      {(busy || loadingRoutes) && <p className="loading-message"><RefreshCw size={17} className="spin" />正在查詢途經路線…</p>}
      {routeError && <div className="inline-error" role="alert">{routeError}<button onClick={() => setRouteRetry(value => value + 1)}>重試</button></div>}
      {!busy && !loadingRoutes && !routeError && !results.length && <p className="empty-message">暫時沒有途經路線資料。</p>}
      <div className="route-grid">{results.map(value => <button className="route-card" key={favouriteKey(value)} onClick={() => onSelect(value)}><span className={"route-number " + value.route.company.toLowerCase()}>{value.route.route}</span><span className="route-body"><span className="route-company">{companyName(value.route.company)}{value.route.company !== 'GMB' && value.route.company !== 'MTR' && value.route.service !== '1' && ` · 特別班次 ${value.route.service}`}</span><strong><span className="towards">往</span> {value.route.to}</strong><span className="route-origin">{value.stop.name} · 第 {value.stop.seq} 站</span></span><ChevronRight size={19} /></button>)}</div>
    </div>}
    <div className="nearby-list">{matches.slice(0, limit).map(stop => <button className="nearby-stop" key={stop.id} aria-pressed={chosen?.id === stop.id} onClick={() => setChosen(stop)}><MapPin size={20} /><span><strong>{stop.name}</strong><small>{stop.id.startsWith('MTR:') ? '港鐵' : stop.id.startsWith('GMB:') ? '綠色小巴' : '九巴／龍運'} · {stop.id}</small></span><ChevronRight size={17} /></button>)}</div>
    {matches.length > limit && <button className="text-button" onClick={() => setLimit(value => value + 20)}>顯示更多車站（尚有 {matches.length - limit} 個）</button>}
  </section>;
}
