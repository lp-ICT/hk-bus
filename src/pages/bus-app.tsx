import { useEffect, useRef, useState } from 'react';
import { ArrowDownUp, ArrowLeft, ArrowRight, BusFront, ChevronRight, Clock3, Download, LocateFixed, MapPin, RefreshCw, Search, Star, WifiOff, X } from 'lucide-react';
import { allKmbStops, arrivalLabel, arrivalsFor, companyName, distance, favouriteKey, routeKey, routesAtStop, routesFor, stopsFor, type Arrival, type Company, type Favourite, type Route, type Stop } from '../lib/bus';

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
  const active = useRef(false);
  async function refresh() {
    if (active.current) return;
    active.current = true; setBusy(true);
    try {
      if (!navigator.onLine) throw new Error('目前離線，連線後才能更新到站時間。');
      const result = await arrivalsFor(selected.route, selected.stop);
      setArrivals(result); setNow(Date.now()); setUpdated(Date.now()); setError('');
    } catch { setArrivals([]); setError('未能取得即時到站資料，請檢查網絡後重試。'); }
    finally { active.current = false; setBusy(false); }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { setNow(Date.now()); if (document.visibilityState === 'visible') void refresh(); }, 30000);
    const online = () => { void refresh(); };
    const offline = () => { setArrivals([]); setError('目前離線，連線後才能更新到站時間。'); };
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    return () => { clearInterval(timer); window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);
  const stale = now - updated > 90000;
  return <div className={compact ? 'eta-panel compact-eta' : 'eta-panel'} aria-live="polite">
    <div className="section-label"><span><span className="live-dot" /> 即時到站預報</span><button className="icon-button" aria-label="更新到站時間" disabled={busy} onClick={() => void refresh()}><RefreshCw size={17} className={busy ? 'spin' : ''} /></button></div>
    {error ? <p role="alert" className="error-text">{error}</p> : busy && !updated ? <p className="muted">正在向巴士公司查詢…</p> : stale ? <p className="error-text">資料已過時，請更新。</p> : arrivals.length ? <div className="eta-times">{Array.from({ length: 2 }, (_, i) => arrivals[i] || { eta: null, remark: '', seq: i + 1 }).map((a, i) => <div key={i} className={i === 0 ? 'first-eta' : ''}><span className="eta-caption">{i === 0 ? '下一班' : `第 ${i + 1} 班`}</span><strong>{arrivalLabel(a.eta, now)}</strong>{a.eta && <time>{new Date(a.eta).toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false })}</time>}{a.remark && <small>{a.remark}</small>}</div>)}</div> : <p className="muted">暫時沒有到站預報，可能尚未開出或已結束服務。</p>}
    <p className="eta-note">{updated ? `更新於 ${new Date(updated).toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false })} · ` : ''}每 30 秒自動更新 · 時間僅供參考</p>
  </div>;
}

export default function BusApp() {
  const [tab, setTab] = useState<'search' | 'favourites' | 'nearby'>('nearby');
  const [query, setQuery] = useState('');
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
  const [nearby, setNearby] = useState<(Stop & { meters: number })[]>([]);
  const [nearBusy, setNearBusy] = useState(false);
  const [nearError, setNearError] = useState('');
  const [nearRoutes, setNearRoutes] = useState<Favourite[] | null>(null);
  const [nearName, setNearName] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const stopRequest = useRef(0);
  const nearRequest = useRef(0);
  const located = useRef(false);
  useEffect(() => { if (!located.current) { located.current = true; void locate(); } }, []);

  async function loadRoutes() {
    setLoading(true); setRouteError('');
    const results = await Promise.allSettled([routesFor('KMB'), routesFor('CTB')]);
    const loaded = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    setRoutes(loaded.sort((a, b) => a.route.localeCompare(b.route, 'en', { numeric: true }) || a.service.localeCompare(b.service)));
    if (results.some(result => result.status === 'rejected')) setRouteError(loaded.length ? '部分巴士公司資料未能載入，可以重試。' : '未能載入路線，請檢查網絡後重試。');
    setLoading(false);
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
    try { localStorage.setItem('bus-favourites-v1', JSON.stringify(next)); setFavourites(next); setNotice(exists ? '已移除收藏' : '已加入收藏，保存在這部裝置'); }
    catch { setNotice('未能儲存收藏，請檢查瀏覽器儲存空間。'); }
  }
  function changeTab(value: typeof tab) { setTab(value); setRoute(null); setSelected(null); }
  async function locate() {
    setNearBusy(true); setNearError(''); setNearby([]); setNearRoutes(null); nearRequest.current++;
    try {
      if (!navigator.geolocation) throw new Error('這個瀏覽器不支援定位。');
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }));
      const { latitude, longitude } = position.coords;
      const stops = await allKmbStops();
      const closest = stops.map(stop => ({ ...stop, meters: distance(latitude, longitude, stop) })).filter(stop => stop.meters <= 1000).sort((a, b) => a.meters - b.meters).slice(0, 20);
      setNearby(closest);
      if (!closest.length) setNearError('你附近 1 公里內沒有九巴／龍運車站。可改用路線搜尋。');
    } catch (error) {
      setNearError(typeof error === 'object' && error && 'code' in error && error.code === 1 ? '定位權限未開啟。請在瀏覽器設定允許位置存取，或改用路線搜尋。' : '暫時未能取得位置或車站資料，請重試。');
    } finally { setNearBusy(false); }
  }
  async function openNearby(stop: Stop) {
    const id = ++nearRequest.current;
    setNearName(stop.name); setNearBusy(true); setNearError(''); setNearRoutes(null);
    try { const result = await routesAtStop(stop.id, routes); if (id === nearRequest.current) setNearRoutes(result); }
    catch { if (id === nearRequest.current) setNearError('未能載入途經路線，請重試。'); }
    finally { if (id === nearRequest.current) setNearBusy(false); }
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
        <span className="route-body"><strong><span className="towards">往</span> {f.route.to}</strong><span className="arrival-stop">{f.stop.name}</span><small className="route-company">{companyName(f.route.company)}{f.route.service !== '1' && ` · 特別班次 ${f.route.service}`}</small></span>
      </button>
      <EtaPanel selected={f} compact />
      <button className={`icon-button row-star ${saved ? 'saved' : ''}`} aria-label={`${saved ? '取消收藏' : '收藏'}${f.route.route} ${f.stop.name}`} onClick={() => toggleFavourite(f)}><Star size={18} fill={saved ? 'currentColor' : 'none'} /></button>
    </article>;
  }
  return <div className="bus-app">
    <header className="app-header"><a className="brand" href={import.meta.env.BASE_URL} aria-label="就到站首頁"><span className="brand-icon"><BusFront size={25} strokeWidth={2.2} /></span><span>就到站<span className="brand-en">HK BUS</span></span></a><button className="install-button" onClick={() => setShowInstall(true)}><Download size={16} /><span>加入主畫面</span></button></header>
    {!online && <div className="offline-banner" role="status"><WifiOff size={16} />目前離線 · 到站預報需要網絡連線</div>}
    <main>
      <section className="intro"><div className="eyebrow"><span /> HONG KONG, ON THE MOVE</div><h1>下一班，<span>幾時到？</span></h1><p>查路線、睇到站，出門心中有數。</p><span className="coverage">九巴 · 龍運 · 城巴</span></section>
      <nav className="tab-bar" aria-label="主要功能">{([{ id: 'search', label: '搜尋路線', icon: Search }, { id: 'favourites', label: '我的收藏', icon: Star }, { id: 'nearby', label: '附近車站', icon: MapPin }] as const).map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => changeTab(item.id)}><item.icon size={19} />{item.label}{item.id === 'favourites' && favourites.length > 0 && <span className="count">{favourites.length}</span>}</button>)}</nav>
      {route ? <section className="route-detail"><button className="back-button" onClick={() => { setRoute(null); setSelected(null); }}><ArrowLeft size={17} />返回路線</button><div className="detail-heading"><span className={`route-number ${route.company.toLowerCase()}`}>{route.route}</span><div><small>{companyName(route.company)}{route.service !== '1' ? ` · 特別班次 ${route.service}` : ''}</small><h2>往 {route.to}</h2><p>由 {route.from} 開出</p></div><button className="icon-button switch-button" aria-label="切換方向" disabled={!routes.some(r => r.company === route.company && r.route === route.route && r.bound !== route.bound)} onClick={() => { const reverse = routes.find(r => r.company === route.company && r.route === route.route && r.bound !== route.bound && r.service === route.service) || routes.find(r => r.company === route.company && r.route === route.route && r.bound !== route.bound); if (reverse) { setRoute(reverse); setSelected(null); } }}><ArrowDownUp size={21} /></button></div><div className="section-label"><span>選擇上車站</span><span>{stops.length} 個車站</span></div>{stopLoading && <p className="loading-message"><RefreshCw size={17} className="spin" />正在載入車站…</p>}{stopError && <p className="error-text" role="alert">{stopError}</p>}{!stopLoading && !stopError && !stops.length && <p className="empty-message">這個方向暫時沒有車站資料，請切換方向。</p>}<div className="stop-list">{stops.map(stop => {
        const value = { route, stop }; const chosen = selected && favouriteKey(selected) === favouriteKey(value); const saved = favourites.some(f => favouriteKey(f) === favouriteKey(value));
        return <div key={`${stop.id}-${stop.seq}`} className={`stop-item ${chosen ? 'selected' : ''}`}><div className="stop-line"><button className="stop-select" onClick={() => setSelected(chosen ? null : value)} aria-expanded={!!chosen}><span className="stop-seq">{stop.seq}</span><strong>{stop.name}</strong><ChevronRight size={17} /></button><button className={`icon-button star-button ${saved ? 'saved' : ''}`} aria-label={`${saved ? '取消收藏' : '收藏'}${stop.name}`} onClick={() => toggleFavourite(value)}><Star size={20} fill={saved ? 'currentColor' : 'none'} /></button></div>{chosen && <EtaPanel key={favouriteKey(value)} selected={value} />}</div>;
      })}</div></section> : <>
        {tab === 'search' && <section className="search-section"><label className="search-box"><Search size={22} /><input aria-label="搜尋巴士路線或目的地" placeholder="輸入路線或目的地，例如 1A、旺角" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" />{query && <button aria-label="清除搜尋" className="icon-button" onClick={() => setQuery('')}><X size={18} /></button>}</label><div className="filter-row">{([{ id: 'all', name: '全部巴士' }, { id: 'KMB', name: '九巴 / 龍運' }, { id: 'CTB', name: '城巴' }] as const).map(c => <button aria-pressed={company === c.id} className={company === c.id ? 'chosen' : ''} key={c.id} onClick={() => setCompany(c.id)}>{c.name}</button>)}</div>{routeError && <div className="inline-error" role="alert">{routeError}<button onClick={() => void loadRoutes()}>重試</button></div>}<div className="section-label"><span>{query ? '搜尋結果' : '路線一覽'}</span><span>{loading ? '載入中' : `${filtered.length} 個方向及班次`}</span></div>{loading ? <p className="loading-message"><RefreshCw size={17} className="spin" />正在載入巴士路線…</p> : displayed.length ? <div className="route-grid">{displayed.map(r => routeButton(r, () => { setRoute(r); setSelected(null); }))}</div> : <div className="empty-state"><Search size={32} /><h2>找不到這條路線</h2><p>試試其他路線號碼或目的地。</p></div>}{filtered.length > 80 && <p className="list-note">顯示首 80 個結果，輸入路線或目的地可縮小範圍。</p>}</section>}
        {tab === 'favourites' && <section><div className="section-label"><span>常用路線，隨手就睇</span><span>{favourites.length} 個收藏</span></div>{favourites.length ? <div className="favourite-list">{favourites.map(f => arrivalRow(f))}</div> : <div className="empty-state"><Star size={36} /><h2>把常搭的巴士，放在這裡。</h2><p>搜尋路線，按車站旁的星星加入收藏。<br />收藏只保存在目前的裝置。</p><button className="primary-button" onClick={() => changeTab('search')}>搜尋路線 <ArrowRight size={17} /></button></div>}</section>}
        {tab === 'nearby' && <section><div className="nearby-intro"><span className="location-icon"><LocateFixed size={26} /></span><div><h2>附近有咩車搭？</h2><p>搜尋 1 公里內的九巴／龍運車站。<br />開啟時請求定位，只讀取一次，不會儲存。</p></div><button className="primary-button" disabled={nearBusy} onClick={() => void locate()}><LocateFixed size={17} />{nearBusy ? '查詢中…' : '找附近車站'}</button></div>{nearError && <p role="alert" className="error-text">{nearError}</p>}{nearBusy && <p className="loading-message"><RefreshCw size={17} className="spin" />正在查詢位置及車站資料…</p>}{nearRoutes !== null && <div className="near-routes"><div className="section-label"><span>{nearName} · 途經路線</span><button onClick={() => setNearRoutes(null)} className="text-button">收起</button></div>{nearRoutes.length ? nearRoutes.map(f => arrivalRow(f)) : <p className="empty-message">暫時沒有途經路線資料。</p>}</div>}<div className="nearby-list">{nearby.map(stop => <button className="nearby-stop" key={stop.id} disabled={nearBusy || loading} onClick={() => void openNearby(stop)}><MapPin size={20} /><span><strong>{stop.name}</strong><small>九巴 / 龍運 · {stop.id}</small></span><b>{Math.round(stop.meters)} 米</b><ChevronRight size={17} /></button>)}</div><p className="list-note">城巴請使用「搜尋路線」查詢車站及到站時間。</p></section>}
      </>}
      <footer><span className="footer-brand"><BusFront size={17} /> 就到站</span><p>資料來自 <a href="https://data.gov.hk/tc-data/dataset/hk-td-tis_21-etakmb" target="_blank" rel="noreferrer">九巴／龍運</a> 及 <a href="https://data.gov.hk/tc-data/dataset/ctb-eta-transport-realtime-eta" target="_blank" rel="noreferrer">城巴</a> 開放數據。<br />非官方應用程式 · 到站時間以巴士公司資料為準</p><span className="footer-note"><Clock3 size={13} /> 香港時間 UTC+8</span></footer>
    </main>
    {notice && <div className="toast" role="status">{notice}</div>}
    {showInstall && <div className="modal-backdrop" onClick={() => setShowInstall(false)}><section className="install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setShowInstall(false); }}><button autoFocus aria-label="關閉安裝說明" className="icon-button modal-close" onClick={() => setShowInstall(false)}><X size={21} /></button><span className="brand-icon"><BusFront size={29} /></span><h2 id="install-title">巴士時間，一按就睇。</h2><p>加入手機主畫面，下次不用再找網址。</p>{install && <button className="primary-button" onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }}>安裝就到站 <Download size={17} /></button>}<div className="install-step"><strong>iPhone · Safari</strong><p>用 Safari 開啟此頁 → 按「分享」 →「加入主畫面」。</p></div><div className="install-step"><strong>Android · Chrome</strong><p>用 Chrome 開啟此頁 → 右上角選單 →「安裝應用程式」或「加至主畫面」。</p></div><small>即時到站仍需網絡連線。收藏不會跨裝置同步。</small></section></div>}
  </div>;
}
