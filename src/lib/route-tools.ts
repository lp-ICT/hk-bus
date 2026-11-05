import { distance, type Route, type Stop } from './bus';

export type Headway = { weekdays: boolean[]; public_holiday: boolean; start_time: string; end_time: string | null; frequency: number | null; frequency_upper: number | null };
export function nearestRouteStop(stops: Stop[], position: { lat: number; lng: number } | null) {
  if (!position) return null;
  return stops.reduce<Stop | null>((best, stop) => Number.isFinite(distance(position.lat, position.lng, stop)) && (!best || distance(position.lat, position.lng, stop) < distance(position.lat, position.lng, best)) ? stop : best, null);
}
export function officialTimetableUrl(route: Route) {
  if (route.company === 'RESIDENT' && route.timetableUrl?.startsWith('https://www.td.gov.hk/')) return route.timetableUrl;
  if (route.company === 'MTR') return 'https://www.mtr.com.hk/ch/customer/services/train_service_index.html';
  if (route.company === 'KMB') return `https://search.kmb.hk/KMBWebSite/?action=routesearch&route=${encodeURIComponent(route.route)}&lang=zh-hk`;
  if (route.company === 'CTB') return 'https://www.citybus.com.hk/routes/routeinfo.aspx?intLangID=2';
  return 'https://www.td.gov.hk/tc/transport_in_hong_kong/public_transport/minibuses/index.html';
}
export function serviceDays(row: Headway) {
  const labels = ['一', '二', '三', '四', '五', '六', '日'];
  const days = labels.filter((_, i) => row.weekdays?.[i]);
  return (days.length === 7 ? '每日' : days.length ? `星期${days.join('、')}` : '指定日子') + (row.public_holiday ? '（包括公眾假期）' : '（公眾假期除外）');
}
export function headwayLabel(row: Headway) {
  if (!Number.isFinite(row.frequency) || Number(row.frequency) <= 0) return '指定開出時間，請參閱官方資料';
  return `每 ${row.frequency}${Number(row.frequency_upper) > Number(row.frequency) ? `–${row.frequency_upper}` : ''} 分鐘一班`;
}
