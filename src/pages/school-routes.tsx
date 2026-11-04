import { useEffect, useRef, useState } from 'react';
import { allKmbStops, schoolSideStops, type Favourite, type Route, type Stop } from '../lib/bus';
import NearbyRoutes from './nearby-routes';

export default function SchoolRoutes({ routes, loadingRoutes, onRefreshRoutes, onSelect, favourites, onToggleFavourite, position }: { favourites: Favourite[]; onToggleFavourite: (value: Favourite) => void; position: { lat: number; lng: number } | null; routes: Route[]; loadingRoutes: boolean; onRefreshRoutes: () => Promise<void>; onSelect: (value: Favourite) => void }) {
  const [side, setSide] = useState<'entrance' | 'opposite'>('entrance');
  const [stops, setStops] = useState<(Stop & { meters: number })[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const mounted = useRef(true);
  const deadline = useRef(Date.now() + 30000);
  async function loadStops() {
    if (active.current) return;
    active.current = true; setBusy(true); setError('');
    try {
      const matches = (await allKmbStops()).filter(stop => /^可風中學(?:\s*\(|$)/.test(stop.name));
      if (!matches.length) throw new Error('missing stops');
      if (mounted.current) setStops(matches.map(stop => ({ ...stop, meters: 0 })));
    } catch {
      if (mounted.current) setError('未能載入可風中學車站資料，請按「立即更新」重試。');
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void loadStops();
    return () => { mounted.current = false; };
  }, []);
  async function refresh() {
    await Promise.all([loadStops(), onRefreshRoutes()]);
  }
  const sideStops = schoolSideStops(stops, side);
  return <section aria-label="李炳中學巴士到站">
    <div className="filter-row school-sides" aria-label="選擇車站位置">{([{ id: 'entrance', label: '李炳中學門口' }, { id: 'opposite', label: '對面車站' }] as const).map(item => <button key={item.id} className={side === item.id ? 'chosen' : ''} aria-pressed={side === item.id} onClick={() => setSide(item.id)}>{item.label}</button>)}</div>
    <p className="station-caption">可風中學 · {side === 'entrance' ? '門口兩個車站（TW310／TW311）' : '對面車站（TW496）'}</p>
    {error && <p role="alert" className="error-text">{error}</p>}
    {!stops.length && <><p className="section-label">可風中學巴士站 · 各方向</p>{busy && <p className="loading-message">正在載入可風中學車站…</p>}<button className="primary-button" disabled={busy || loadingRoutes} onClick={() => void refresh()}>立即更新</button></>}
    {!!stops.length && <NearbyRoutes key={side} favourites={favourites} onToggleFavourite={onToggleFavourite} position={position} stationName={side === 'entrance' ? '李炳中學門口' : '對面車站'} stops={sideStops} routes={routes} loadingRoutes={loadingRoutes} onSelect={onSelect} onRefresh={refresh} locating={busy} startupDeadline={deadline.current} />}
  </section>;
}
