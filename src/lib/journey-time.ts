import { distance, routeKey, type Arrival } from './bus';
import type { Journey } from './journey';

export type JourneyTimes = { version: number; snapshot_at: string; routes: Record<string, [number, number][]> };
export type TimedJourney = Journey & { arrivals: Arrival[]; legArrivals?: Arrival[][]; updated: number; error: boolean };
export type JourneyEstimate = { arrival?: number; reason?: string; walking: number; waiting: number; riding: number; legs: { boarding: number; alighting: number; walking: number; waiting: number; riding: number }[] };
export function withJourneyTimes(journey: Journey, times?: JourneyTimes): Journey {
  const points = times?.routes[routeKey(journey.route)];
  const at = (seq: number) => {
    const exact = points?.find(point => point[0] === seq);
    if (exact) return exact[1];
    const after = points?.findIndex(point => point[0] > seq) ?? -1;
    if (!points || after <= 0) return undefined;
    const [a, b] = [points[after - 1], points[after]];
    return a[1] + (b[1] - a[1]) * (seq - a[0]) / (b[0] - a[0]);
  };
  const start = at(journey.stop.seq), end = at(journey.alight.seq);
  return { ...journey, rideMinutes: journey.route.company === 'MTR' ? (distance(journey.stop.lat, journey.stop.lng, journey.alight) * 1.2 / 583 + (journey.alight.seq - journey.stop.seq) * 0.75) : start !== undefined && end !== undefined && end > start ? end - start : undefined, transfer: journey.transfer ? { ...journey.transfer, leg: withJourneyTimes(journey.transfer.leg, times) } : undefined };
}
export function estimateJourney(journey: TimedJourney, now: number): JourneyEstimate {
  const result: JourneyEstimate = { walking: 0, waiting: 0, riding: 0, legs: [] };
  const fail = (reason: string) => ({ ...result, reason });
  if (journey.route.company === 'RESIDENT') return fail('居民巴士未有即時預報，請核對官方時間表及服務時段');
  if (!Number.isFinite(journey.meters)) return fail('請先選擇起點或允許定位');
  if (!journey.updated) return fail('正在取得到站資料');
  if (journey.error || now - journey.updated > 90000) return fail('到站資料過期或更新失敗');
  let ready = now;
  let leg: Journey | undefined = journey;
  let index = 0;
  const walkMinutes = (meters: number) => meters * 1.3 / 75;
  while (leg) {
    if (leg.route.company === 'RESIDENT') return fail('第' + (index + 1) + '程為居民巴士，請核對官方時間表及服務時段');
    if (!Number.isFinite(leg.rideMinutes) || leg.rideMinutes! <= 0) return fail('第' + (index + 1) + '程未有可配對的參考車程');
    const walking = walkMinutes(index === 0 ? journey.meters : leg.meters);
    if (!Number.isFinite(walking) || walking < 0) return fail('步行距離資料不足');
    const buffer = leg.route.company === 'MTR' ? (index ? 5 : 3) : index ? 2 : 0;
    ready += (walking + buffer) * 60000;
    const arrivals = journey.legArrivals?.[index] || (index === 0 ? journey.arrivals : []);
    const boarding = Math.min(...arrivals.filter(arrival => arrival.eta).map(arrival => Date.parse(arrival.eta!)).filter(time => Number.isFinite(time) && time >= ready));
    if (!Number.isFinite(boarding)) return fail(index ? '第' + (index + 1) + '程未有可接駁的到站預報' : '未有步行到站後可乘搭的預報');
    const waiting = (boarding - ready) / 60000 + buffer;
    const riding = leg.rideMinutes!;
    ready = boarding + riding * 60000;
    result.walking += walking; result.waiting += waiting; result.riding += riding;
    result.legs.push({ boarding, alighting: ready, walking, waiting, riding });
    if (!leg.transfer) break;
    leg = { ...leg.transfer.leg, meters: leg.transfer.meters };
    index++;
  }
  const finalWalk = walkMinutes(journey.endMeters);
  if (!Number.isFinite(finalWalk) || finalWalk < 0) return fail('目的地步行距離資料不足');
  result.walking += finalWalk;
  result.arrival = ready + finalWalk * 60000;
  return result;
}
export function compareJourneyArrival(a: TimedJourney, b: TimedJourney, now: number) {
  const first = estimateJourney(a, now).arrival ?? Infinity;
  const second = estimateJourney(b, now).arrival ?? Infinity;
  return first === second ? 0 : first < second ? -1 : 1;
}
export function estimateClock(time: number) {
  return new Date(Math.ceil(time / 60000) * 60000).toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false, hour: '2-digit', minute: '2-digit' });
}
