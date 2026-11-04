import { useEffect, useRef, useState } from 'react';
import { allTransitStops, distance, schoolSideStops, type Favourite, type Route, type Stop } from '../lib/bus';
import NearbyRoutes from './nearby-routes';
import { schoolPlace } from '../lib/journey';

export default function SchoolRoutes({ routes, loadingRoutes, onRefreshRoutes, onSelect, favourites, onToggleFavourite, position }: { favourites: Favourite[]; onToggleFavourite: (value: Favourite) => void; position: { lat: number; lng: number } | null; routes: Route[]; loadingRoutes: boolean; onRefreshRoutes: () => Promise<void>; onSelect: (value: Favourite) => void }) {
  const [side, setSide] = useState<'entrance' | 'opposite' | 'minibus'>('entrance');
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
      const matches = (await allTransitStops()).filter(stop => /^可風中學(?:\s*\(|$)/.test(stop.name) || stop.id.startsWith('GMB:') && distance(schoolPlace.lat, schoolPlace.lng, stop) <= 400);
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
  const sideStops = side === 'minibus' ? stops.filter(stop => stop.id.startsWith('GMB:')) : schoolSideStops(stops, side);
  return <section aria-label="李炳中學巴士到站">
    <div className="filter-row school-sides" aria-label="選擇車站位置">{([{ id: 'entrance', label: '李炳中學門口' }, { id: 'opposite', label: '對面車站' }, { id: 'minibus', label: '附近小巴站' }] as const).map(item => <button key={item.id} className={side === item.id ? 'chosen' : ''} aria-pressed={side === item.id} onClick={() => setSide(item.id)}>{item.label}</button>)}</div>
    <p className="station-caption">可風中學 · {side === 'entrance' ? '門口巴士站（TW310／TW311）及可風中學小巴站' : side === 'opposite' ? '對面巴士站（TW496）；官方未列對面小巴站，可選附近小巴站' : '學校 400 米內小巴站，請留意各站名稱及實際步行路徑'}</p>
    {error && <p role="alert" className="error-text">{error}</p>}
    {!stops.length && <><p className="section-label">可風中學巴士站 · 各方向</p>{busy && <p className="loading-message">正在載入可風中學車站…</p>}<button className="primary-button" disabled={busy || loadingRoutes} onClick={() => void refresh()}>立即更新</button></>}
    {!!stops.length && <NearbyRoutes key={side} favourites={favourites} onToggleFavourite={onToggleFavourite} position={position} stationName={side === 'entrance' ? '李炳中學門口' : side === 'opposite' ? '對面車站' : '學校附近小巴站'} stops={sideStops} routes={routes} loadingRoutes={loadingRoutes} onSelect={onSelect} onRefresh={refresh} locating={busy} startupDeadline={deadline.current} />}
  </section>;
}
