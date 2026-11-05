import proj4 from 'proj4';
import { mkdir } from 'node:fs/promises';

const names: Record<string, string> = { AEL: '機場快綫', TCL: '東涌綫', TML: '屯馬綫', TKL: '將軍澳綫', EAL: '東鐵綫', SIL: '南港島綫', TWL: '荃灣綫', ISL: '港島綫', KTL: '觀塘綫', DRL: '迪士尼綫' };
const hk80 = '+proj=tmerc +lat_0=22.3121333333333 +lon_0=114.178555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,-0.067753,2.243648,1.158828,-1.094246 +units=m +no_defs';
await mkdir('.gmb-cache/mtr', { recursive: true });
async function download(url: string, key: string) {
  const file = Bun.file('.gmb-cache/mtr/' + key);
  if (await file.exists() && Date.now() - file.lastModified < 86400000) return file.text();
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const text = await response.text();
      if (!text.trim()) throw new Error('Empty MTR metadata');
      await Bun.write(file, text);
      return text;
    } catch (error) { if (attempt >= 2) throw error; }
  }
}
const csv = await download('https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv', 'stations.csv');
const records = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1).map(line => {
  const cells = (line.match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g) || []).filter(Boolean).map(cell => cell.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
  return { line: cells[0], direction: cells[1], code: cells[2], name: cells[4], english: cells[5], seq: Number(cells[6]) };
}).filter(row => names[row.line] && row.code && Number.isFinite(row.seq));
if (records.length < 200) throw new Error('Incomplete MTR station CSV');
const unique = [...new Map(records.map(row => [row.code, row])).values()];
const stops: { id: string; name: string; lat: number; lng: number; seq: number; code: string }[] = [];
for (let offset = 0; offset < unique.length; offset += 4) {
  stops.push(...await Promise.all(unique.slice(offset, offset + 4).map(async station => {
    const query = station.name.replace(/茘/g, '荔') + '站';
    const locations = JSON.parse(await download('https://www.map.gov.hk/gs/api/v1.0.0/locationSearch?q=' + encodeURIComponent(query), station.code + '.json'));
    const exact = locations.find((row: any) => row.nameZH === query || row.nameZH === '港鐵' + query)
      || locations.find((row: any) => row.nameEN === station.english + ' Station' || row.nameZH === query + ' (別稱)');
    if (!exact || !Number.isFinite(exact.x) || !Number.isFinite(exact.y)) throw new Error('Missing verified station coordinates: ' + station.code + ' ' + query);
    const [lng, lat] = proj4(hk80, 'EPSG:4326', [exact.x, exact.y]);
    if (!(lat > 22 && lat < 23 && lng > 113 && lng < 115)) throw new Error('Invalid station position');
    return { id: 'MTR:' + station.code, code: station.code, name: query, lat, lng, seq: 0 };
  })));
}
const grouped = new Map<string, typeof records>();
for (const row of records) {
  const key = row.line + ':' + row.direction;
  grouped.set(key, [...(grouped.get(key) || []), row]);
}
const routes: any[] = [], rows: any[] = [];
for (const [key, values] of grouped) {
  const ordered = values.sort((a, b) => a.seq - b.seq);
  const first = ordered[0], last = ordered.at(-1)!;
  const bound = first.direction.endsWith('UT') ? 'UP' : 'DOWN';
  const service = first.line + ':' + first.direction;
  routes.push({ company: 'MTR', route: names[first.line], bound, service, from: first.name, to: last.name, region: first.line });
  ordered.forEach((row, i) => rows.push({ company: 'MTR', route: names[row.line], bound, service_type: service, stop: 'MTR:' + row.code, seq: i + 1, pickup: i < ordered.length - 1 && !(row.line === 'AEL' && bound === 'DOWN' && ['TSY', 'KOW'].includes(row.code)), dropoff: i > 0 && !(row.line === 'AEL' && bound === 'UP' && ['TSY', 'KOW'].includes(row.code)) }));
}
if (new Set(routes.map(route => route.region)).size !== 10 || stops.length < 90) throw new Error('Incomplete MTR network');
const output = { snapshot_at: new Date().toISOString(), routes, stops, rows, sources: ['https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv', 'https://www.map.gov.hk/gs/api/v1.0.0/locationSearch'] };
await Bun.write('public/bus-data/mtr-network.json', JSON.stringify(output));
console.log('MTR: ' + stops.length + ' stations, ' + routes.length + ' directional paths');
