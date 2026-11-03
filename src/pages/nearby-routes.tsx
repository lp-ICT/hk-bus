import { useEffect, useRef, useState } from 'react';
import { arrivalLabel, nearbyArrivals, nearestRoutes, sortNearby, type Favourite, type NearbyArrival, type Route, type Stop } from '../lib/bus';

type Result = NearbyArrival & { updated: number };
const rowKey = (row: NearbyArrival) => `${row.route.company}-${row.route.route}-${row.route.bound}`;
export default function NearbyRoutes({ stops, routes, loadingRoutes, onSelect, onRefresh, locating, startupDeadline }: { onRefresh: () => Promise<void>; locating: boolean; startupDeadline: number; stops: (Stop & { meters: number })[]; routes: Route[]; loadingRoutes: boolean; onSelect: (value: Favourite) => void }) {
  const [rows, setRows] = useState<Result[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [next, setNext] = useState(0);
  const savedRef = useRef<Result[]>([]);
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let due = 0;
    let saved: Result[] = savedRef.current;
    let incomplete = false;
    setRows(saved); setBusy(true); setError(''); setNext(0);
    async function refresh() {
      if (loadingRoutes || running || cancelled) return;
      running = true; setBusy(true);
      try {
        const results: NearbyArrival[] = [];
        let failures = 0;
        for (let offset = 0; offset < stops.length; offset += 3) {
          const batch = await Promise.allSettled(stops.slice(offset, offset + 3).map(stop => nearbyArrivals(stop, routes)));
          if (cancelled) return;
          for (const result of batch) {
            if (result.status === 'fulfilled') results.push(...result.value);
            else failures++;
          }
        }
        if (cancelled) return;
        const at = Date.now();
        const incoming = nearestRoutes(results);
        const previous = new Map(saved.map(row => [rowKey(row), row]));
        const merged = incoming.map(row => {
          const old = previous.get(rowKey(row));
          previous.delete(rowKey(row));
          return row.error && old ? { ...old, error: true } : { ...row, updated: row.error ? 0 : at };
        });
        incomplete = failures > 0 || results.some(row => row.error);
        if (incomplete) merged.push(...[...previous.values()].map(row => ({ ...row, error: true })));
        saved = merged; savedRef.current = saved;
        setRows(saved); setNow(at);
        setError(incomplete ? (saved.some(row => row.updated) ? '部分資料更新失敗，保留上次成功結果；請留意各路線資料時間。' : '未能取得完整到站資料，請按「立即更新」重試。') : '');
      } catch {
        incomplete = true;
        if (!cancelled) { saved = saved.map(row => ({ ...row, error: true })); savedRef.current = saved; setRows(saved); setError(saved.length ? '更新失敗，保留上次成功結果，請留意資料時間。' : '首次載入失敗，請檢查網絡並按「立即更新」重試。'); }
      } finally {
        running = false;
        if (!cancelled) { due = Date.now() + (incomplete && Date.now() + 5000 <= startupDeadline ? 5000 : 30000); setNext(due); setBusy(false); }
      }
    }
    void refresh();
    const timer = setInterval(() => {
      setNow(Date.now());
      if (due && Date.now() >= due && document.visibilityState === 'visible') void refresh();
    }, 1000);
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); };
  }, [stops, routes, loadingRoutes, startupDeadline]);
  const display = sortNearby(rows.map(row => ({ ...row, arrivals: row.arrivals.filter(a => a.eta && Date.parse(a.eta) > now - 60000) })), now) as Result[];
  return <div className="near-routes">
    <div className="section-label"><span>附近路線 · 最快到站優先</span><span>{busy ? '更新中…' : error && !rows.length ? '資料暫未能取得' : `${rows.length} 條路線及方向`}</span></div>
    <div className="nearby-refresh"><span role="timer">{busy || locating ? '正在更新資料…' : `下次更新：${Math.max(0, Math.ceil((next - now) / 1000))} 秒`}</span><button className="primary-button" disabled={busy || loadingRoutes || locating} onClick={() => void onRefresh()}>立即更新</button></div>
    {error && <p className="error-text" role="alert">{error}</p>}
    {!rows.length && busy && <p className="loading-message">正在查詢附近路線及即時到站時間…</p>}
    {display.map(row => <button className="route-card" key={rowKey(row)} onClick={() => onSelect(row)}>
      <span className="route-number kmb">{row.route.route}</span>
      <span className="route-body"><strong>往 {row.route.to}</strong><span className="route-origin">{row.stop.name} · {Math.round(row.meters)} 米</span><small className={row.error ? 'error-text' : 'route-company'}>{row.updated ? `資料時間 ${new Date(row.updated).toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false })}${row.error ? ' · 更新失敗，舊資料' : now - row.updated > 90000 ? ' · 資料已過時' : ''}` : '到站資料未能取得'}</small></span>
      <span className="nearby-times">{row.arrivals.length ? row.arrivals.map((a, i) => <span key={i}><small>{['下一班', '第二班', '第三班'][i]}</small><strong>{arrivalLabel(a.eta, now)}</strong></span>) : <strong>{row.error ? '查詢失敗' : '未有預報'}</strong>}</span>
    </button>)}
    {!busy && !rows.length && !error && <p className="empty-message">附近車站暫時沒有路線資料。</p>}
    <p className="list-note">每 30 秒自動更新 · 同路線同方向只列最近上車站 · 最多三班預報</p>
  </div>;
}
