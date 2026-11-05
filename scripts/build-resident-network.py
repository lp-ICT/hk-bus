import datetime
import json
import time
from pathlib import Path
import requests

root = Path(__file__).resolve().parents[1]
cache = root / '.gmb-cache' / 'journey-BUS.json'
if not cache.exists() or time.time() - cache.stat().st_mtime > 86400:
    response = requests.get('https://static.data.gov.hk/td/routes-fares-geojson/JSON_BUS.json', timeout=60)
    response.raise_for_status()
    value = json.loads(response.content.decode('utf-8-sig'))
    if not value.get('features'):
        raise RuntimeError('Official bus network is empty')
    cache.write_text(json.dumps(value, ensure_ascii=False))
groups = {}
for feature in json.loads(cache.read_text(encoding='utf-8-sig'))['features']:
    p = feature['properties']
    if p['companyCode'] not in ['PI', 'DB']:
        continue
    groups.setdefault((str(p['routeId']), str(p['routeSeq'])), []).append(feature)
routes, stops, rows = [], {}, []
for (service, bound), features in groups.items():
    features.sort(key=lambda feature: int(feature['properties']['stopSeq']))
    p = features[0]['properties']
    source = p.get('hyperlinkC', '')
    if not source.startswith('https://www.td.gov.hk/') or len(features) < 2:
        raise RuntimeError('Incomplete official resident route ' + p['routeNameC'])
    special = {'N': '通宵班次', 'NT': '夜間／指定時段班次', 'T': '指定時段班次'}.get(p['serviceMode'], '一般班次')
    routes.append({'company': 'RESIDENT', 'route': p['routeNameC'], 'bound': bound, 'service': service, 'region': p['companyCode'], 'from': p['locStartNameC'] if bound == '1' else p['locEndNameC'], 'to': p['locEndNameC'] if bound == '1' else p['locStartNameC'], 'description': special, 'timetableUrl': source, 'journeyMinutes': p.get('journeyTime')})
    for feature in features:
        prop = feature['properties']
        lng, lat = feature['geometry']['coordinates']
        if not 113 < lng < 115 or not 21 < lat < 24:
            raise RuntimeError('Invalid resident stop coordinates')
        stop = 'RESIDENT:' + p['companyCode'] + ':' + str(prop['stopId'])
        stops[stop] = {'id': stop, 'name': prop['stopNameC'], 'lat': lat, 'lng': lng, 'seq': 0, 'etaAvailable': False}
        rows.append({'company': 'RESIDENT', 'route': p['routeNameC'], 'bound': bound, 'service_type': service, 'stop': stop, 'seq': prop['stopSeq'], 'pickup': prop['stopPickDrop'] in [2, 3], 'dropoff': prop['stopPickDrop'] in [1, 3]})
for number in ['NR330', 'NR332']:
    if not all(any(r['route'] == number and r['bound'] == bound for r in routes) for bound in ['1', '2']):
        raise RuntimeError('Missing required resident direction ' + number)
output = root / 'public/bus-data/resident-network.json'
value = {'version': 1, 'snapshot_at': datetime.datetime.fromtimestamp(cache.stat().st_mtime, datetime.timezone.utc).isoformat(), 'source': 'https://static.data.gov.hk/td/routes-fares-geojson/JSON_BUS.json', 'routes': routes, 'stops': list(stops.values()), 'rows': rows}
temporary = output.with_suffix('.tmp')
temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')))
temporary.replace(output)
print(f'Resident network: {len(routes)} directions, {len(stops)} stops; no live ETA')
