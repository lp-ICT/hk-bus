import datetime
import json
import math
from pathlib import Path
import time
import requests

root = Path(__file__).resolve().parents[1]
cache = root / '.gmb-cache'
cache.mkdir(exist_ok=True)

def geo(name):
    path = cache / ('journey-' + name + '.json')
    if not path.exists() or time.time() - path.stat().st_mtime > 86400:
        response = requests.get('https://static.data.gov.hk/td/routes-fares-geojson/JSON_' + name + '.json', timeout=60)
        response.raise_for_status()
        value = json.loads(response.content.decode('utf-8-sig'))
        if not value.get('features'):
            raise RuntimeError('Missing official journey data: ' + name)
        path.write_text(json.dumps(value, ensure_ascii=False))
    return json.loads(path.read_text(encoding='utf-8-sig'))['features']

def meters(a, b):
    lat1, lng1 = a
    lat2, lng2 = b
    x = math.radians(lng2 - lng1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return 6371000 * math.hypot(x, y)

candidates = {}
for kind in ['BUS', 'GMB']:
    groups = {}
    for feature in geo(kind):
        p = feature['properties']
        if kind == 'BUS' and not any(code in p['companyCode'] for code in ['KMB', 'LWB']):
            continue
        key = (str(p['routeId']), str(p['routeSeq']))
        if key not in groups:
            groups[key] = {'properties': p, 'points': []}
        coordinates = feature['geometry']['coordinates']
        groups[key]['points'].append((int(p['stopSeq']), (coordinates[1], coordinates[0])))
    for group in groups.values():
        p = group['properties']
        if not isinstance(p.get('journeyTime'), (float, int)) or not 0 < p['journeyTime'] <= 360:
            continue
        group['points'].sort()
        key = ('GMB', str(p['routeId']), str(p['routeSeq'])) if kind == 'GMB' else ('KMB', p['routeNameC'])
        candidates.setdefault(key, []).append(group)

read = lambda name: json.loads((root / 'dist' / 'bus-data' / (name + '.json')).read_text())
kmb_stops = {s['stop']: (float(s['lat']), float(s['long'])) for s in read('kmb-stops')['data']}
gmb = json.loads((root / 'public' / 'bus-data' / 'gmb-network.json').read_text())
stops = {**kmb_stops, **{s['id']: (s['lat'], s['lng']) for s in gmb['stops']}}
rows = read('kmb-route-stops')['data'] + gmb['rows']
grouped = {}
for row in rows:
    key = (row.get('company', 'KMB'), row['route'], str(row['bound']), str(row['service_type']))
    if row['stop'] in stops:
        grouped.setdefault(key, []).append((float(row['seq']), stops[row['stop']]))
result = {}
for key, ordered in grouped.items():
    ordered.sort()
    company, number, bound, service = key
    choices = candidates.get(('GMB', service, bound) if company == 'GMB' else ('KMB', number), [])
    best = None
    for choice in choices:
        points = [point for _, point in choice['points']]
        if len(points) < 2 or not 0.8 <= len(ordered) / len(points) <= 1.25:
            continue
        ends = meters(ordered[0][1], points[0]) + meters(ordered[-1][1], points[-1])
        if meters(ordered[0][1], points[0]) > 180 or meters(ordered[-1][1], points[-1]) > 180:
            continue
        index = 0
        matched = 0
        for _, point in ordered:
            nearest = min(range(index, len(points)), key=lambda i: meters(point, points[i]))
            if meters(point, points[nearest]) <= 180:
                index = nearest
                matched += 1
        if matched / len(ordered) < 0.9:
            continue
        if best is None or ends < best[0]:
            best = (ends, choice)
    if best is None:
        continue
    full = float(best[1]['properties']['journeyTime'])
    weights = [0.0]
    for i in range(1, len(ordered)):
        weights.append(weights[-1] + meters(ordered[i - 1][1], ordered[i][1]) + 200)
    if not weights[-1]:
        continue
    result['-'.join(key)] = [[seq, round(weight / weights[-1] * full, 3)] for (seq, _), weight in zip(ordered, weights)]
if len(result) < 500:
    raise RuntimeError('Too few matched official journey times: ' + str(len(result)))
output = root / 'dist' / 'bus-data' / 'journey-times.json'
output.write_text(json.dumps({'version': 1, 'snapshot_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'routes': result}, separators=(',', ':')))
print('Official journey time matches:', len(result), '/', len(grouped), flush=True)
