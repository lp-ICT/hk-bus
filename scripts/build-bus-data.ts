export {};

const mtrBuild = Bun.spawnSync(['bun', 'scripts/build-mtr-data.ts'], { stdout: 'inherit', stderr: 'inherit' });
if (mtrBuild.exitCode !== 0) throw new Error('Cannot build official MTR metadata');
await Bun.write('dist/bus-data/mtr-network.json', Bun.file('public/bus-data/mtr-network.json'));

if (process.env.USE_EXISTING_GMB === '1') {
  const saved = await Bun.file('public/bus-data/gmb-network.json').json();
  if (!saved.routes?.length || !saved.rows?.length || !saved.stops?.length || !Number.isFinite(Date.parse(saved.snapshot_at)) || Date.now() - Date.parse(saved.snapshot_at) > 86400000) throw new Error('Existing minibus snapshot is missing, invalid or older than 24 hours');
  console.log('Preserving validated GMB snapshot: ' + saved.snapshot_at);
} else {
  const gmbBuild = Bun.spawnSync(['python', 'scripts/build-gmb-data.py'], { stdout: 'inherit', stderr: 'inherit' });
  if (gmbBuild.exitCode !== 0) throw new Error('Cannot build official minibus metadata');
}
await Bun.write('dist/bus-data/gmb-network.json', Bun.file('public/bus-data/gmb-network.json'));


const sources = {
  'kmb-routes': 'https://data.etabus.gov.hk/v1/transport/kmb/route/',
  'kmb-stops': 'https://data.etabus.gov.hk/v1/transport/kmb/stop',
  'kmb-route-stops': 'https://data.etabus.gov.hk/v1/transport/kmb/route-stop',
  'ctb-routes': 'https://rt.data.gov.hk/v2/transport/citybus/route/CTB',
};
for (const [name, url] of Object.entries(sources)) {
  let saved = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${url}?build=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (!Array.isArray(json.data) || !json.data.length) throw new Error('Empty metadata');
      await Bun.write(`dist/bus-data/${name}.json`, JSON.stringify({ ...json, snapshot_at: new Date().toISOString() }));
      console.log(`${name}: ${json.data.length} records`);
      saved = true;
      break;
    } catch (error) {
      if (attempt === 2) throw new Error(`Cannot build official metadata backup: ${name}`, { cause: error });
    }
  }
  if (!saved) throw new Error(`Missing metadata: ${name}`);
}

const timeBuild = Bun.spawnSync(['python', 'scripts/build-journey-times.py'], { stdout: 'inherit', stderr: 'inherit' });
if (timeBuild.exitCode !== 0) throw new Error('Cannot build official journey time reference');
