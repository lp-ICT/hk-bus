import { distance } from './bus';
import type { Place } from './journey';

const normalName = (name: string) => name.trim().replace(/\s*[（(][A-Z]{1,3}\d+[）)]\s*$/i, '').replace(/^(香港|港鐵)/, '').replace(/\s+/g, '').toLowerCase();
const attractions = [
  { query: /^(香港)?海洋公園$/, name: '香港海洋公園', station: '海洋公園站', stationId: 'MTR:OCP' },
  { query: /^(香港)?迪士尼(樂園)?$/, name: '香港迪士尼樂園', station: '迪士尼站', stationId: 'MTR:DIS' },
];

export function organisePlaces(query: string, places: Place[]): Place[] {
  places = places.filter(place => !/除[顫颤]器|\baed\b|defibrillator/i.test(place.name));
  const term = normalName(query);
  const landmark = attractions.find(value => value.query.test(query.trim()));
  const station = landmark && places.find(place => normalName(place.name) === normalName(landmark.station));
  const targetName = landmark ? normalName(landmark.name) : term;
  const exact = places.filter(place => normalName(place.name) === targetName && !place.detail?.startsWith('港鐵站'));
  const main = landmark && exact.filter(place => !/前稱|別稱/.test(place.name))
    .sort((a, b) => station ? distance(station.lat, station.lng, a) - distance(station.lat, station.lng, b) : 0)[0];
  const classified = places.map(place => {
    const rail = place.detail?.startsWith('港鐵站') || !!landmark && normalName(place.name) === normalName(landmark.station);
    const attraction = !!main && place === main;
    const name = attraction ? landmark!.name : place.name;
    return { ...place, name, railStationId: attraction && station && distance(station.lat, station.lng, place) <= 600 ? landmark!.stationId : undefined, detail: attraction ? '景點 · 建議選擇 · ' + (place.detail || '') : rail ? '港鐵站 · ' + (place.detail || '').replace(/^港鐵站位置 · /, '') : '地點／地址 · ' + (place.detail || '') };
  }).filter(place => !main || !/前稱|別稱/.test(place.name))
    .filter(place => !main || !/除顫器|獸醫|動物護理|進出口|進出入口|社區園圃/.test(place.name));
  const rank = (place: Place) => place.detail?.startsWith('景點') ? 0 : normalName(place.name) === term ? 1 : place.detail?.startsWith('港鐵站') ? 2 : 3;
  classified.sort((a, b) => rank(a) - rank(b));
  const result: Place[] = [];
  for (const place of classified) {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue;
    if (main && normalName(place.name) === targetName && !place.detail?.startsWith('港鐵站') && distance(main.lat, main.lng, place) > 400) continue;
    if (result.some(other => normalName(other.name) === normalName(place.name) && distance(other.lat, other.lng, place) < 80)) continue;
    result.push(place);
  }
  return result.slice(0, 24);
}
