import { useEffect, useRef, useState } from 'react';
import { ArrowDownUp, ArrowLeft, ArrowRight, BusFront, ChevronRight, Clock3, Download, MapPin, QrCode, RefreshCw, Search, Star, WifiOff, X } from 'lucide-react';
import { allKmbStops, distanceLabel, noArrivalMessage, arrivalLabel, arrivalsFor, companyName, distance, favouriteKey, routeKey, routesFor, stopsFor, type Arrival, type Company, type Favourite, type Route, type Stop } from '../lib/bus';

import StopSearch from './stop-search';
import JourneyPlanner from './journey-planner';
import NearbyRoutes from './nearby-routes';
import PullRefresh from './pull-refresh';
import SchoolRoutes from './school-routes';
import ShareQr from './share-qr';
import ConnectionStatus from './connection-status';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
function readFavourites(): Favourite[] {
  try { const value = JSON.parse(localStorage.getItem('bus-favourites-v1') || '[]'); return Array.isArray(value) ? value.filter(f => f?.route?.route && f?.stop?.id) : []; } catch { return []; }
}

function EtaPanel({ selected, compact = false }: { selected: Favourite; compact?: boolean }) {
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(0);
  const [busy, setBusy] = useState(true);
  const [now, setNow] = useState(Date.now());
  const refreshAction = useRef<() => void>(() => {});
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let due = 0;
    async function refresh() {
      if (running || cancelled) return;
      running = true; setBusy(true);
      try {
        if (!navigator.onLine) throw new Error('offline');
        const result = await arrivalsFor(selected.route, selected.stop);
        if (!cancelled) { setArrivals(result); setNow(Date.now()); setUpdated(Date.now()); setError(''); }
      } catch {
        if (!cancelled) setError('更新失敗，請重試。');
      } finally {
        running = false; due = Date.now() + 30000;
        if (!cancelled) setBusy(false);
      }
    }
    refreshAction.current = () => { void refresh(); };
    void refresh();
    const timer = setInterval(() => { setNow(Date.now()); if (Date.now() >= due && document.visibilityState === 'visible') void refresh(); }, 1000);
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    const offline = () => setError('目前離線，保留上次成功資料；請連線後更新。');
    window.addEventListener('online', resume); window.addEventListener('offline', offline); document.addEventListener('visibilitychange', resume);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('online', resume); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', resume); };
  }, [selected]);
  const stale = updated > 0 && now - updated > 90000;
  const display = arrivals.filter(a => a.eta && Date.parse(a.eta) > now - 60000).slice(0, 3);
  return <div className={compact ? 'eta-panel compact-eta' : 'eta-panel'} aria-live="polite">
    <div className="section-label"><span><span className="live-dot" /> 即時到站預報</span><button className="icon-button" aria-label="更新到站時間" disabled={busy} onClick={() => refreshAction.current()}><RefreshCw size={17} className={busy ? 'spin' : ''} /></button></div>
    {error && <p role="alert" className="data-warning">{error}</p>}
    {(error && updated > 0 || stale) && <p className="data-warning">{stale ? '資料已過時' : '舊資料'} · 請更新後再確認到站時間</p>}
    {busy && !updated ? <p className="muted">正在向巴士公司查詢…</p> : display.length ? <div className={`eta-times ${error || stale ? 'stale-times' : ''}`}>{display.map((a, i) => <div key={i} className={i === 0 ? 'first-eta' : ''}><span className="eta-caption">{i === 0 ? '下一班' : `第 ${i + 1} 班`}</span><strong>{arrivalLabel(a.eta, now)}</strong><time>{new Date(a.eta!).toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false })}</time>{a.remark && <small>{a.remark}</small>}</div>)}</div> : <p className="muted">{error && !updated ? '到站資料未能取得，請重試。' : noArrivalMessage(arrivals)}</p>}
    <p className={`eta-note ${error || stale ? 'data-warning' : ''}`}>{updated ? `上次成功更新 ${new Date(updated).toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false })} · ` : ''}每 30 秒自動更新 · 時間僅供參考</p>
  </div>;
}

export default function BusApp() {
  const [tab, setTab] = useState<'search' | 'favourites' | 'nearby' | 'school' | 'toSchool'>('nearby');
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'route' | 'journey'>('route');
  const [company, setCompany] = useState<'all' | Company>('all');
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [routeError, setRouteError] = useState('');
  const [route, setRoute] = useState<Route | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [stopError, setStopError] = useState('');
  const [stopLoading, setStopLoading] = useState(false);
  const [selected, setSelected] = useState<Favourite | null>(null);
  const [favourites, setFavourites] = useState<Favourite[]>(readFavourites);
  const [notice, setNotice] = useState('');
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [nearby, setNearby] = useState<(Stop & { meters: number })[]>([]);
  const [nearBusy, setNearBusy] = useState(false);
  const [nearError, setNearError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const stopRequest = useRef(0);
  const located = useRef(false);
  const startupDeadline = useRef(Date.now() + 30000);
  const locationReady = useRef(false);
  const routeReady = useRef(false);
  const locationActive = useRef(false);
  const routeActive = useRef(false);
  useEffect(() => { if (!located.current) { located.current = true; void locate(); } }, []);

  async function loadRoutes() {
    if (routeActive.current) return;
    routeActive.current = true;
    setLoading(true); setRouteError('');
    const results = await Promise.allSettled([routesFor('KMB'), routesFor('CTB')]);
    const loaded = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    routeReady.current = results.every(result => result.status === 'fulfilled');
    if (loaded.length) setRoutes(loaded.sort((a, b) => a.route.localeCompare(b.route, 'en', { numeric: true }) || a.service.localeCompare(b.service)));
    if (results.some(result => result.status === 'rejected')) setRouteError(loaded.length ? '部分巴士公司資料未能載入，可以重試。' : '未能載入路線，請檢查網絡後重試。');
    setLoading(false); routeActive.current = false;
  }
  useEffect(() => {
    void loadRoutes();
    const status = () => setOnline(navigator.onLine);
    const prompt = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    window.addEventListener('online', status); window.addEventListener('offline', status);
    window.addEventListener('beforeinstallprompt', prompt);
    if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
    return () => { window.removeEventListener('online', status); window.removeEventListener('offline', status); window.removeEventListener('beforeinstallprompt', prompt); };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() > startupDeadline.current) { clearInterval(timer); return; }
      if (!locationReady.current) void locate();
      if (!routeReady.current) void loadRoutes();
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  async function refreshNearby() {
    await Promise.all([locate(), loadRoutes()]);
  }
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const id = ++stopRequest.current;
    setStops([]); setStopError('');
    if (!route) { setStopLoading(false); return; }
    setStopLoading(true);
    stopsFor(route).then(value => { if (id === stopRequest.current) setStops(value); })
      .catch(() => { if (id === stopRequest.current) setStopError('未能載入車站，請重新選擇路線重試。'); })
      .finally(() => { if (id === stopRequest.current) setStopLoading(false); });
  }, [route]);

  function toggleFavourite(value: Favourite) {
    const exists = favourites.some(f => favouriteKey(f) === favouriteKey(value));
    const next = exists ? favourites.filter(f => favouriteKey(f) !== favouriteKey(value)) : [...favourites, value];
    try { localStorage.setItem('bus-favourites-v1', JSON.stringify(next)); setFavourites(next); setNotice(exists ? '已移除收藏' : '已收藏此路線、方向及上車站'); }
    catch { setNotice('未能儲存收藏，請檢查瀏覽器儲存空間。'); }
  }
  function changeTab(value: typeof tab) { setTab(value); setRoute(null); setSelected(null); }
  async function locate() {
    if (locationActive.current) return;
    locationActive.current = true;
    setNearBusy(true); setNearError('');
    try {
      if (!navigator.geolocation) throw new Error('這個瀏覽器不支援定位。');
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 4500, maximumAge: 0 }));
      const { latitude, longitude } = position.coords;
      setPosition({ lat: latitude, lng: longitude });
      const stops = await allKmbStops();
      const closest = stops.map(stop => ({ ...stop, meters: distance(latitude, longitude, stop) })).filter(stop => stop.meters <= 1000).sort((a, b) => a.meters - b.meters).slice(0, 20);
      locationReady.current = true;
      setNearby(closest);
      if (!closest.length) setNearError('你附近 1 公里內沒有九巴／龍運車站。可改用路線搜尋。');
    } catch (error) {
      setNearError(typeof error === 'object' && error && 'code' in error && error.code === 1 ? '定位權限未開啟。請在瀏覽器設定允許位置存取，或改用路線搜尋。' : '暫時未能取得位置或車站資料，請按「立即更新」重試，或改用路線搜尋。');
    } finally { locationActive.current = false; setNearBusy(false); }
  }
  const cleanQuery = query.trim().toUpperCase();
  const filtered = routes.filter(r => (company === 'all' || r.company === company) && (!cleanQuery || r.route.includes(cleanQuery) || r.from.includes(query.trim()) || r.to.includes(query.trim())));
  const displayed = [...filtered].sort((a, b) => Number(b.route === cleanQuery) - Number(a.route === cleanQuery)).slice(0, 80);
  function routeButton(r: Route, click: () => void, subtitle?: string) {
    return <button className="route-card" key={routeKey(r) + (subtitle || '')} onClick={click}><span className={`route-number ${r.company.toLowerCase()}`}>{r.route}</span><span className="route-body"><span className="route-company">{companyName(r.company)}{r.service !== '1' && ` · 特別班次 ${r.service}`}</span><strong><span className="towards">往</span> {r.to}</strong><span className="route-origin">{subtitle || `由 ${r.from} 開出`}</span></span><ChevronRight size={19} className="chevron" /></button>;
  }
  function arrivalRow(f: Favourite) {
    const saved = favourites.some(value => favouriteKey(value) === favouriteKey(f));
    return <article className="arrival-row" key={favouriteKey(f)}>
      <button className="arrival-open" onClick={() => { setRoute(f.route); setSelected(f); }}>
        <span className={`route-number ${f.route.company.toLowerCase()}`}>{f.route.route}</span>
        <span className="route-body"><strong><span className="towards">往</span> {f.route.to}</strong><span className="arrival-stop">{f.stop.name}{position && <small className="stop-distance">{distanceLabel(distance(position.lat, position.lng, f.stop))}</small>}</span><small className="route-company">{companyName(f.route.company)}{f.route.service !== '1' && ` · 特別班次 ${f.route.service}`}</small></span>
      </button>
      <EtaPanel selected={f} compact />
      <button className={`icon-button row-star ${saved ? 'saved' : ''}`} aria-label={`${saved ? '取消收藏' : '收藏'}${f.route.route} ${f.stop.name}`} onClick={() => toggleFavourite(f)}><Star size={18} fill={saved ? 'currentColor' : 'none'} /></button>
    </article>;
  }
  return <div className="bus-app">
    <PullRefresh enabled={tab === 'nearby' && !route && !showInstall && !showQr} busy={nearBusy || loading} onRefresh={refreshNearby} />
    <header className="app-header"><a className="brand" href={import.meta.env.BASE_URL} aria-label="就到站首頁"><span className="brand-icon"><BusFront size={25} strokeWidth={2.2} /></span><span>就到站<span className="brand-en app-version">v{import.meta.env.VITE_APP_VERSION}</span></span></a><div className="header-actions"><button className="install-button" onClick={() => setShowInstall(true)}><Download size={16} /><span>加入主畫面</span></button><button className="install-button qr-button" aria-label="顯示網站 QR code" title="顯示網站 QR code" onClick={() => setShowQr(true)}><QrCode size={18} /><span>QR code</span></button></div></header>
    {!online && <div className="offline-banner" role="status"><WifiOff size={16} />目前離線 · 到站預報需要網絡連線</div>}
    <main>
      <nav className="tab-bar" aria-label="主要功能">{([{ id: 'search', label: '搜尋路線', icon: Search }, { id: 'favourites', label: '我的收藏', icon: Star }, { id: 'nearby', label: '附近路線', icon: MapPin }, { id: 'school', label: '放學啦', icon: BusFront }, { id: 'toSchool', label: '返學啦', icon: BusFront }] as const).map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => changeTab(item.id)}><item.icon size={19} />{item.label}{item.id === 'favourites' && favourites.length > 0 && <span className="count">{favourites.length}</span>}</button>)}</nav>
      <ConnectionStatus />
      {route ? <section className="route-detail"><button className="back-button" onClick={() => { setRoute(null); setSelected(null); }}><ArrowLeft size={17} />返回路線</button><div className="detail-heading"><span className={`route-number ${route.company.toLowerCase()}`}>{route.route}</span><div><small>{companyName(route.company)}{route.service !== '1' ? ` · 特別班次 ${route.service}` : ''}</small><h2>往 {route.to}</h2><p>由 {route.from} 開出</p></div><button className="icon-button switch-button" aria-label="切換方向" disabled={!routes.some(r => r.company === route.company && r.route === route.route && r.bound !== route.bound)} onClick={() => { const reverse = routes.find(r => r.company === route.company && r.route === route.route && r.bound !== route.bound && r.service === route.service) || routes.find(r => r.company === route.company && r.route === route.route && r.bound !== route.bound); if (reverse) { setRoute(reverse); setSelected(null); } }}><ArrowDownUp size={21} /></button></div><div className="section-label"><span>選擇上車站</span><span>{stops.length} 個車站</span></div>{stopLoading && <p className="loading-message"><RefreshCw size={17} className="spin" />正在載入車站…</p>}{stopError && <p className="error-text" role="alert">{stopError}</p>}{!stopLoading && !stopError && !stops.length && <p className="empty-message">這個方向暫時沒有車站資料，請切換方向。</p>}<div className="stop-list">{stops.map(stop => {
        const value = { route, stop }; const chosen = selected && favouriteKey(selected) === favouriteKey(value); const saved = favourites.some(f => favouriteKey(f) === favouriteKey(value));
        return <div key={`${stop.id}-${stop.seq}`} className={`stop-item ${chosen ? 'selected' : ''}`}><div className="stop-line"><button className="stop-select" onClick={() => setSelected(chosen ? null : value)} aria-expanded={!!chosen}><span className="stop-seq">{stop.seq}</span><strong>{stop.name}{position && <small className="stop-distance">{distanceLabel(distance(position.lat, position.lng, stop))}</small>}</strong><ChevronRight size={17} /></button><button className={`icon-button star-button ${saved ? 'saved' : ''}`} aria-label={`${saved ? '取消收藏' : '收藏'}${stop.name}`} onClick={() => toggleFavourite(value)}><Star size={20} fill={saved ? 'currentColor' : 'none'} /></button></div>{chosen && <EtaPanel key={favouriteKey(value)} selected={value} />}</div>;
      })}</div></section> : <>
        {tab === 'search' && <div className="filter-row search-modes" aria-label="搜尋方式"><button className={searchMode === 'route' ? 'chosen' : ''} aria-pressed={searchMode === 'route'} onClick={() => setSearchMode('route')}>路線／車站</button><button className={searchMode === 'journey' ? 'chosen' : ''} aria-pressed={searchMode === 'journey'} onClick={() => setSearchMode('journey')}>起點 → 目的地</button></div>}
        {tab === 'search' && searchMode === 'journey' && <JourneyPlanner routes={routes} loadingRoutes={loading} position={position} favourites={favourites} onToggleFavourite={toggleFavourite} onSelect={value => { setRoute(value.route); setSelected(value); }} />}
        {tab === 'toSchool' && <JourneyPlanner school routes={routes} loadingRoutes={loading} position={position} favourites={favourites} onToggleFavourite={toggleFavourite} onSelect={value => { setRoute(value.route); setSelected(value); }} />}
        {tab === 'search' && searchMode === 'route' && <section className="search-section"><label className="search-box"><Search size={22} /><input aria-label="搜尋巴士路線、車站或地點" placeholder="輸入路線、車站或地點，例如 1A、田寮新村" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" />{query && <button aria-label="清除搜尋" className="icon-button" onClick={() => setQuery('')}><X size={18} /></button>}</label><div className="filter-row">{([{ id: 'all', name: '全部巴士' }, { id: 'KMB', name: '九巴 / 龍運' }, { id: 'CTB', name: '城巴' }] as const).map(c => <button aria-pressed={company === c.id} className={company === c.id ? 'chosen' : ''} key={c.id} onClick={() => setCompany(c.id)}>{c.name}</button>)}</div>{routeError && <div className="inline-error" role="alert">{routeError}<button onClick={() => void loadRoutes()}>重試</button></div>}{query.trim() && company !== 'CTB' && <StopSearch query={query} routes={routes} loadingRoutes={loading} onSelect={value => { setRoute(value.route); setSelected(value); }} />}<div className="section-label"><span>{query ? '路線／起點／目的地搜尋結果' : '路線一覽'}</span><span>{loading ? '載入中' : `${filtered.length} 個方向及班次`}</span></div>{loading ? <p className="loading-message"><RefreshCw size={17} className="spin" />正在載入巴士路線…</p> : displayed.length ? <div className="route-grid">{displayed.map(r => routeButton(r, () => { setRoute(r); setSelected(null); }))}</div> : <div className="empty-state"><Search size={32} /><h2>找不到這條路線</h2><p>試試其他路線號碼、起點或目的地；車站搜尋結果會顯示在上方。</p></div>}{filtered.length > 80 && <p className="list-note">顯示首 80 個結果，輸入路線或目的地可縮小範圍。</p>}</section>}
        {tab === 'favourites' && <section><div className="section-label"><span>常用路線，隨手就睇</span><span>{favourites.length} 個收藏</span></div>{favourites.length ? <div className="favourite-list">{favourites.map(f => arrivalRow(f))}</div> : <div className="empty-state"><Star size={36} /><h2>把常搭的巴士，放在這裡。</h2><p>搜尋路線，按車站旁的星星加入收藏。<br />收藏指定方向及上車站，只保存在目前的裝置。</p><button className="primary-button" onClick={() => changeTab('search')}>搜尋路線 <ArrowRight size={17} /></button></div>}</section>}
        {tab === 'school' && routeError && <p role="alert" className="error-text">{routeError}</p>}
        {tab === 'school' && <SchoolRoutes favourites={favourites} onToggleFavourite={toggleFavourite} position={position} routes={routes} loadingRoutes={loading} onRefreshRoutes={loadRoutes} onSelect={value => { setRoute(value.route); setSelected(value); }} />}
        {tab === 'nearby' && <section>{nearError && <p role="alert" className="error-text">{nearError}</p>}{nearBusy && <p className="loading-message"><RefreshCw size={17} className="spin" />正在查詢位置及車站資料…</p>}{nearby.length === 0 && <button className="primary-button" disabled={nearBusy || loading} onClick={() => void refreshNearby()}>立即更新</button>}{nearby.length > 0 && <NearbyRoutes favourites={favourites} onToggleFavourite={toggleFavourite} position={position} onRefresh={refreshNearby} locating={nearBusy} startupDeadline={startupDeadline.current} stops={nearby} routes={routes} loadingRoutes={loading} onSelect={value => { setRoute(value.route); setSelected(value); }} />}<p className="list-note">城巴請使用「搜尋路線」查詢車站及到站時間。</p></section>}
      </>}
      <footer><span className="footer-brand"><BusFront size={17} /> 就到站</span><p>資料來自 <a href="https://data.gov.hk/tc-data/dataset/hk-td-tis_21-etakmb" target="_blank" rel="noreferrer">九巴／龍運</a> 及 <a href="https://data.gov.hk/tc-data/dataset/ctb-eta-transport-realtime-eta" target="_blank" rel="noreferrer">城巴</a> 開放數據。<br />非官方應用程式 · 到站時間以巴士公司資料為準</p><span className="footer-note"><Clock3 size={13} /> 香港時間 UTC+8</span></footer>
    </main>
    {notice && <div className="toast" role="status">{notice}</div>}
    {showQr && <ShareQr onClose={() => setShowQr(false)} />}
    {showInstall && <div className="modal-backdrop" onClick={() => setShowInstall(false)}><section className="install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setShowInstall(false); }}><button autoFocus aria-label="關閉安裝說明" className="icon-button modal-close" onClick={() => setShowInstall(false)}><X size={21} /></button><span className="brand-icon"><BusFront size={29} /></span><h2 id="install-title">巴士時間，一按就睇。</h2><p>加入手機主畫面，下次不用再找網址。</p>{install && <button className="primary-button" onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }}>安裝就到站 <Download size={17} /></button>}<div className="install-step"><strong>iPhone · Safari</strong><p>用 Safari 開啟此頁 → 按「分享」 →「加入主畫面」。</p></div><div className="install-step"><strong>Android · Chrome</strong><p>用 Chrome 開啟此頁 → 右上角選單 →「安裝應用程式」或「加至主畫面」。</p></div><small>即時到站仍需網絡連線。收藏不會跨裝置同步。</small></section></div>}
  </div>;
}
