import concurrent.futures
import datetime
import json
import pathlib
import time
import requests
import urllib.parse

root = pathlib.Path(__file__).resolve().parents[1]
cache = root / '.gmb-cache'
cache.mkdir(exist_ok=True)

def fetch(path):
    saved = cache / (path.strip('/').replace('/', '-') + '.json')
    if saved.exists() and time.time() - saved.stat().st_mtime < 86400:
        return json.loads(saved.read_text())
    for attempt in range(4):
        try:
            response = requests.get('https://data.etagmb.gov.hk' + urllib.parse.quote(path, safe='/') + ('?retry=' + str(time.time()) if attempt else ''), timeout=25)
            response.raise_for_status()
            data = response.json()['data']
            saved.write_text(json.dumps(data, ensure_ascii=False))
            return data
        except Exception:
            if attempt == 3:
                raise RuntimeError('Failed official GMB endpoint: ' + path)
            time.sleep(attempt + 1)

def parallel(fn, values):
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(fn, values))

listing = fetch('/route')['routes']
variants = parallel(lambda item: fetch('/route/' + item[0] + '/' + item[1]), [(region, code) for region, codes in listing.items() for code in codes])
routes = []
for group in variants:
    for variant in group:
        for direction in variant['directions']:
            routes.append({'company': 'GMB', 'route': variant['route_code'], 'bound': str(direction['route_seq']), 'service': str(variant['route_id']), 'from': direction['orig_tc'], 'to': direction['dest_tc'], 'region': variant['region'], 'description': variant['description_tc']})
print('GMB directions:', len(routes), flush=True)

def route_stops(route):
    rows = fetch('/route-stop/' + route['service'] + '/' + route['bound'])['route_stops']
    return [{'route': route['route'], 'bound': route['bound'], 'service_type': route['service'], 'company': 'GMB', 'stop': 'GMB:' + str(row['stop_id']), 'seq': row['stop_seq'], 'name': row['name_tc']} for row in rows]
rows = [row for group in parallel(route_stops, routes) for row in group]
names = {row['stop']: row['name'] for row in rows}
print('GMB stops:', len(names), flush=True)

geo_path = cache / 'gmb-geo.json'
if not geo_path.exists() or time.time() - geo_path.stat().st_mtime > 86400:
    response = requests.get('https://static.data.gov.hk/td/routes-fares-geojson/JSON_GMB.json', timeout=60)
    response.raise_for_status()
    geo_path.write_bytes(response.content)
features = json.loads(geo_path.read_text(encoding='utf-8-sig'))['features']
coordinates = {str(feature['properties']['stopId']): feature['geometry']['coordinates'] for feature in features}
permissions = {(str(f['properties']['routeId']), str(f['properties']['routeSeq']), str(f['properties']['stopId'])): f['properties']['stopPickDrop'] for f in features}
for row in rows:
    mode = permissions.get((row['service_type'], row['bound'], row['stop'].split(':')[1]), 3)
    row['pickup'] = mode != 1
    row['dropoff'] = mode != 2

def stop_info(item):
    stop_id, name = item
    point = coordinates.get(stop_id.split(':')[1])
    if point:
        return {'id': stop_id, 'name': name, 'lat': point[1], 'lng': point[0], 'seq': 0, 'enabled': True}
    data = fetch('/stop/' + stop_id.split(':')[1])
    coords = data['coordinates']['wgs84']
    return {'id': stop_id, 'name': name, 'lat': coords['latitude'], 'lng': coords['longitude'], 'seq': 0, 'enabled': data['enabled']}
stops = parallel(stop_info, names.items())
active = {stop['id'] for stop in stops if stop['enabled']}
result = {'routes': routes, 'rows': [row for row in rows if row['stop'] in active], 'stops': [stop for stop in stops if stop['enabled']], 'missing_coordinates': sum(stop['lat'] == 0 for stop in stops), 'snapshot_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
output = root / 'public' / 'bus-data' / 'gmb-network.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
print(str(output), flush=True)
