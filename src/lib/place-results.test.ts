import { expect, test } from 'bun:test';
import { organisePlaces } from './place-results';
import type { Place } from './journey';

const station: Place = { name: '海洋公園站', lat: 22.24914, lng: 114.17456, detail: '港鐵站位置 · 景點請確認入口及步行路線' };
const attraction: Place = { name: '香港海洋公園', lat: 22.24865, lng: 114.17491, detail: '南區 · 黃竹坑道180號' };
test('Ocean Park suggests the main attraction and clearly labelled rail station without duplicate or internal facilities', () => {
  const results = organisePlaces('海洋公園', [
    station, { ...attraction, lat: 22.234, lng: 114.171 }, attraction,
    { ...attraction, lat: attraction.lat + 0.000001 },
    { ...station, name: '港鐵海洋公園站', detail: '南區' },
    { ...station, name: '海洋公園獸醫院', detail: '香港海洋公園' },
    { ...station, name: '自動心臟除顫器 - 海洋公園站', detail: '海洋公園站' },
    { ...attraction, name: '海洋公園 (前稱)' },
  ]);
  expect(results).toHaveLength(2);
  expect(results[0].name).toBe('香港海洋公園');
  expect(results[0].lat).toBeCloseTo(attraction.lat, 4);
  expect(results[0].railStationId).toBe('MTR:OCP');
  expect(results[0].detail).toContain('景點 · 建議選擇');
  expect(results[1].detail).toStartWith('港鐵站');
});
test('Disney alias suggests the park separately from its station', () => {
  const results = organisePlaces('迪士尼', [
    { ...station, name: '迪士尼站' }, { ...attraction, name: '香港迪士尼樂園' },
  ]);
  expect(results[0].name).toBe('香港迪士尼樂園');
  expect(results[0].detail).toContain('建議選擇');
  expect(results[1].name).toBe('迪士尼站');
});
test('explicit facility and address searches remain available and distant namesakes remain separate', () => {
  const facility = { ...attraction, name: '海洋公園獸醫院' };
  expect(organisePlaces('海洋公園獸醫院', [station, facility])[0].name).toBe(facility.name);
  expect(organisePlaces('同名大廈', [
    { ...attraction, name: '同名大廈' }, { ...attraction, name: '同名大廈', lat: 22.4 },
  ])).toHaveLength(2);
});

test('official station search fallback still identifies the park near rail instead of the distant park centre', () => {
  const results = organisePlaces('海洋公園', [
    { ...attraction, lat: 22.234, lng: 114.171 }, attraction,
    { ...station, detail: '南區' },
  ]);
  expect(results[0].lat).toBeCloseTo(attraction.lat, 4);
  expect(results[0].railStationId).toBe('MTR:OCP');
  expect(results[1].detail).toStartWith('港鐵站');
});


test('all place queries exclude defibrillator entries while retaining their surrounding destinations', () => {
  const school = { ...attraction, name: '聖公會李炳中學' };
  const rows = [school, ...['自動心臟除顫器 - 李炳中學', '自动体外除颤器', 'AED - School', 'Automated External Defibrillator'].map(name => ({ ...school, name }))];
  for (const query of ['李炳中學', 'AED', '除顫器', '學校']) {
    expect(organisePlaces(query, rows).map(place => place.name)).toEqual([school.name]);
  }
});

 test('Mei Tin terminal matches station names with bay codes ahead of unrelated terminals', () => {
  const results = organisePlaces('美田巴士總站', [
    { name: '西九龍站巴士總站', lat: 22.3, lng: 114.16 },
    { name: '美田巴士總站 (TA975)', lat: 22.376324, lng: 114.170565, detail: '巴士站位置' },
    { name: '美田巴士總站 (TA972)', lat: 22.376324, lng: 114.170565, detail: '巴士站位置' },
  ]);
  expect(results[0].name).toBe('美田巴士總站 (TA975)');
  expect(results.filter(place => place.name.startsWith('美田'))).toHaveLength(1);
});
