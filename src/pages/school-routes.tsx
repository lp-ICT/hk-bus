import { useEffect, useRef, useState } from 'react';
import { allKmbStops, type Favourite, type Route, type Stop } from '../lib/bus';
import NearbyRoutes from './nearby-routes';

export default function SchoolRoutes({ routes, loadingRoutes, onRefreshRoutes, onSelect }: { routes: Route[]; loadingRoutes: boolean; onRefreshRoutes: () => Promise<void>; onSelect: (value: Favourite) => void }) {
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
  return <section aria-label="李炳中學巴士到站">
    {error && <p role="alert" className="error-text">{error}</p>}
    {!stops.length && <><p className="section-label">可風中學巴士站 · 各方向</p>{busy && <p className="loading-message">正在載入可風中學車站…</p>}<button className="primary-button" disabled={busy || loadingRoutes} onClick={() => void refresh()}>立即更新</button></>}
    {!!stops.length && <NearbyRoutes stationName="可風中學" stops={stops} routes={routes} loadingRoutes={loadingRoutes} onSelect={onSelect} onRefresh={refresh} locating={busy} startupDeadline={deadline.current} />}
  </section>;
}
