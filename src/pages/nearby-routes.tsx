import { useEffect, useState } from 'react';
import { arrivalLabel, favouriteKey, nearbyArrivals, sortNearby, type Favourite, type NearbyArrival, type Route, type Stop } from '../lib/bus';

export default function NearbyRoutes({ stops, routes, loadingRoutes, onSelect }: { stops: (Stop & { meters: number })[]; routes: Route[]; loadingRoutes: boolean; onSelect: (value: Favourite) => void }) {
  const [rows, setRows] = useState<NearbyArrival[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let running = false;
    setRows([]); setUpdated(0); setBusy(true); setError('');
    async function refresh() {
      if (loadingRoutes || running) return;
      running = true; setBusy(true);
      try {
        const results: NearbyArrival[] = [];
        let failures = 0;
        for (let offset = 0; offset < stops.length; offset += 5) {
          const batch = await Promise.allSettled(stops.slice(offset, offset + 5).map(stop => nearbyArrivals(stop, routes)));
          if (cancelled) return;
          for (const result of batch) {
            if (result.status === 'fulfilled') results.push(...result.value);
            else failures++;
          }
        }
        if (!cancelled) {
          setRows(sortNearby(results)); setUpdated(Date.now());
          setError(failures || results.some(row => row.error) ? '部分到站資料未能取得，未有預報的路線排在最後。' : '');
        }
      } catch { if (!cancelled) { setRows([]); setError('未能載入附近路線，請檢查網絡後重試。'); } }
      finally { running = false; if (!cancelled) setBusy(false); }
    }
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30000);
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); };
  }, [stops, routes, loadingRoutes]);
  return <div className="near-routes" aria-live="polite">
    <div className="section-label"><span>附近路線 · 最快到站優先</span><span>{busy ? '更新中…' : `${rows.length} 個上車選擇`}</span></div>
    {error && <p className="error-text" role="alert">{error}</p>}
    {!updated && busy && <p className="loading-message">正在查詢附近路線及即時到站時間…</p>}
    {rows.map(row => <button className="route-card" key={favouriteKey(row)} onClick={() => onSelect(row)}>
      <span className="route-number kmb">{row.route.route}</span>
      <span className="route-body"><strong>往 {row.route.to}</strong><span className="route-origin">{row.stop.name} · {Math.round(row.meters)} 米{row.route.service !== '1' ? ` · 特別班次 ${row.route.service}` : ''}</span></span>
      <strong>{row.error ? '查詢失敗' : arrivalLabel(row.arrivals.find(a => a.eta)?.eta || null, updated)}</strong>
    </button>)}
    {!busy && !rows.length && !error && <p className="empty-message">附近車站暫時沒有路線資料。</p>}
    {updated > 0 && <p className="list-note">每 30 秒更新及重新排序 · 未有預報排最後 · 同一路線於不同車站分開顯示</p>}
  </div>;
}
