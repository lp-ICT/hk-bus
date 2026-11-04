import { useEffect, useState } from 'react';
import { data, type Route } from '../lib/bus';
import { headwayLabel, officialTimetableUrl, serviceDays, type Headway } from '../lib/route-tools';

export default function RouteTimetable({ route }: { route: Route }) {
  const [rows, setRows] = useState<Headway[]>([]);
  const [status, setStatus] = useState('正在讀取官方時間表…');
  useEffect(() => {
    let cancelled = false;
    setRows([]);
    if (route.company !== 'GMB') return;
    setStatus('正在讀取官方時間表…');
    data<{ route_id: number; directions: { route_seq: number; headways: Headway[] }[] }[]>(`https://data.etagmb.gov.hk/route/${route.region}/${encodeURIComponent(route.route)}`)
      .then(variants => {
        if (cancelled) return;
        const rows = variants.find(v => String(v.route_id) === route.service)?.directions.find(d => String(d.route_seq) === route.bound)?.headways || [];
        setRows(rows); setStatus(rows.length ? '' : '官方暫未提供此方向的服務時間表。');
      }).catch(() => { if (!cancelled) setStatus('未能讀取時間表，請關閉後重試，或查看官方資料。'); });
    return () => { cancelled = true; };
  }, [route]);
  return <section className="route-timetable"><h3>{route.route} 往 {route.to} · 服務時間</h3>{route.company === 'GMB' ? <>{status && <p role="status">{status}</p>}{rows.map((row, i) => <div className="timetable-row" key={i}><strong>{serviceDays(row)}</strong><span>{row.start_time.slice(0, 5)}{row.end_time ? ` – ${row.end_time.slice(0, 5)}` : ' 開出（單班）'}</span><span>{headwayLabel(row)}</span></div>)}<p className="list-note">以上為起點站開出時間及班次間隔，並非中途站到站時間。跨午夜時段延續至翌日，以官方安排為準。</p></> : <p>按下方按鈕開啟官方路線查詢，選擇 {route.route} 往 {route.to} 的方向及服務時間；並非即時到站預報。</p>}<a className="text-button" href={officialTimetableUrl(route)} target="_blank" rel="noreferrer">開啟官方{route.company === 'CTB' ? '路線查詢' : '時間表資料'} ↗</a></section>;
}
