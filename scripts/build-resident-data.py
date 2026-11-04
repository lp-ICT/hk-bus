import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import urlopen
from bs4 import BeautifulSoup

root = Path(__file__).resolve().parents[1]
routes = []
sources = []
for region, label in [('hk', '香港島'), ('kln', '九龍'), ('nt', '新界')]:
    url = f'https://www.td.gov.hk/tc/transport_in_hong_kong/public_transport/non_franchised/list_of_approved_rs_{region}/index.html'
    sources.append(url)
    soup = BeautifulSoup(urlopen(url, timeout=45).read(), 'html.parser')
    found = []
    for row in soup.select('tr'):
        cells = row.find_all('td', recursive=False)
        if len(cells) != 2:
            continue
        for link in cells[0].find_all('a', href=True):
            number = link.get_text(strip=True).upper().replace(' ', '')
            if not re.fullmatch(r'(?:NR|HR|KR)\d+[A-Z]?|DB\d+R', number):
                continue
            source = urljoin(url, link['href'])
            if not source.startswith('https://www.td.gov.hk/'):
                raise ValueError(source)
            found.append(dict(route=number, description=cells[1].get_text(' ', strip=True), region=label, source=source))
    if len(found) < 10:
        raise ValueError(f'Incomplete source: {region}: {len(found)}')
    routes.extend(found)
    print(label, len(found))
if not {'NR330', 'NR332', 'NR338S'}.issubset({r['route'] for r in routes}):
    raise ValueError('Missing required routes')
keys = [(r['route'], r['description']) for r in routes]
if len(keys) != len(set(keys)):
    raise ValueError('Duplicate routes')
data = dict(updatedAt=datetime.now(timezone.utc).isoformat(), sources=sources, routes=routes)
output = root / 'src/lib/resident-data.json'
output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
print(f'{len(routes)} routes: {output}')
