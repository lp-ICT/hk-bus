import { distance } from './bus';

export function startupTab(at: Date, position: { lat: number; lng: number } | null, school: { lat: number; lng: number }): 'nearby' | 'toSchool' | 'school' {
  const hk = new Date(at.getTime() + 8 * 60 * 60 * 1000);
  const day = hk.getUTCDay();
  const minutes = hk.getUTCHours() * 60 + hk.getUTCMinutes();
  if (day === 0 || day === 6) return 'nearby';
  if (minutes >= 390 && minutes <= 540) return 'toSchool';
  if (minutes >= 945 && minutes <= 1140 && position && distance(position.lat, position.lng, school) <= 300) return 'school';
  return 'nearby';
}
