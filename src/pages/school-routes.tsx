import { usePageRefresh } from '../lib/page-refresh';
import { useEffect, useRef, useState } from 'react';
import { allTransitStops, distance, schoolSideStops, type Favourite, type Route, type Stop } from '../lib/bus';
import NearbyRoutes from './nearby-routes';
import JourneyPlanner from './journey-planner';
import { schoolPlace } from '../lib/journey';

export default function SchoolRoutes({ routes, loadingRoutes, onRefreshRoutes, onSelect, favourites, onToggleFavourite, position }: { favourites: Favourite[]; onToggleFavourite: (value: Favourite) => void; position: { lat: number; lng: number } | null; routes: Route[]; loadingRoutes: boolean; onRefreshRoutes: () => Promise<void>; onSelect: (value: Favourite) => void }) {
  const [view, setView] = useState<'nearby' | 'destination'>('nearby');
  const [side, setSide] = useState<'entrance' | 'opposite'>('entrance');
  const [mode, setMode] = useState<'all' | 'bus' | 'minibus'>('all');
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
  usePageRefresh(loadStops);
  const sideStops = schoolSideStops(stops, side).filter(stop => mode === 'all' || (mode === 'minibus') === stop.id.startsWith('GMB:'));
  return <section aria-label="李炳中學巴士到站">
    <div className="filter-row" aria-label="放學搜尋方式"><button className={view === 'nearby' ? 'chosen' : ''} onClick={() => setView('nearby')}>學校附近路線</button><button className={view === 'destination' ? 'chosen' : ''} onClick={() => setView('destination')}>搜尋目的地</button></div>
    {view === 'destination' ? <JourneyPlanner fromSchool routes={routes} loadingRoutes={loadingRoutes} position={position} favourites={favourites} onToggleFavourite={onToggleFavourite} onSelect={onSelect} /> : <>
    <div className="filter-row school-sides" aria-label="選擇車站位置">{([{ id: 'entrance', label: '李炳中學門口' }, { id: 'opposite', label: '對面車站' }] as const).map(item => <button key={item.id} className={side === item.id ? 'chosen' : ''} aria-pressed={side === item.id} onClick={() => setSide(item.id)}>{item.label}</button>)}</div>
    <div className="filter-row" aria-label="交通工具">{([{ id: 'all', label: '全部' }, { id: 'bus', label: '巴士' }, { id: 'minibus', label: '小巴' }] as const).map(item => <button key={item.id} className={mode === item.id ? 'chosen' : ''} aria-pressed={mode === item.id} onClick={() => setMode(item.id)}>{item.label}</button>)}</div>
    <p className="station-caption">{side === 'entrance' ? '門口巴士及小巴站 · 312 往梨木樹' : '對面巴士及小巴站 · 312 往青衣站（青衣城）'}。312 學校分站由使用者確認，位置約略，未有官方即時預報。</p>
    {error && <p role="alert" className="error-text">{error}</p>}
    {!stops.length && <><p className="section-label">可風中學巴士站 · 各方向</p>{busy && <p className="loading-message">正在載入可風中學車站…</p>}<button className="primary-button" disabled={busy || loadingRoutes} onClick={() => void refresh()}>立即更新</button></>}
    {!!stops.length && <NearbyRoutes key={`${side}-${mode}`} favourites={favourites} onToggleFavourite={onToggleFavourite} position={position} stationName={side === 'entrance' ? '李炳中學門口' : '對面車站'} stops={sideStops} routes={routes} loadingRoutes={loadingRoutes} onSelect={onSelect} onRefresh={refresh} locating={busy} startupDeadline={deadline.current} />}
    </>}
  </section>;
}
