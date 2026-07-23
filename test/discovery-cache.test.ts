import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DiscoveryCache } from '../src/network/discovery-cache';
import type { DiscoveredAndroidTv } from '../src/types';

function discovered(host: string): DiscoveredAndroidTv {
  return {
    id: 'stable-tv-id',
    discoveryId: 'AA:BB:CC:DD:EE:FF',
    name: 'Percee TV',
    host,
    port: 6466,
    serviceName: 'Percee TV._androidtvremote2._tcp.local',
    hostname: 'percee-tv.local',
    mac: 'AA:BB:CC:DD:EE:FF',
    model: 'Percee',
    manufacturer: 'Android TV',
    txt: { id: 'percee-stable-id', mac: 'AA:BB:CC:DD:EE:FF' },
  };
}

test('discovery cache follows an IP change without changing device identity', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'atvu-discovery-'));
  const responses = [[discovered('10.1.99.20')], [discovered('10.1.99.44')]];
  const cache = new DiscoveryCache(directory, async () => responses.shift() ?? []);

  await cache.scan(1);
  const initial = await cache.resolveDevice({
    id: 'configured-percee',
    name: 'Percee TV',
    host: '10.1.99.20',
    mac: 'aa-bb-cc-dd-ee-ff',
  });
  assert.equal(initial.host, '10.1.99.20');
  assert.equal(initial.id, 'configured-percee');

  await cache.scan(1);
  const updated = await cache.resolveDevice(initial);
  assert.equal(updated.host, '10.1.99.44');
  assert.equal(updated.id, 'configured-percee');
  assert.equal(cache.list()[0]?.aliases.includes('configured-percee'), true);

  const restored = new DiscoveryCache(directory, async () => []);
  await restored.load();
  assert.equal((await restored.resolveDevice(initial)).host, '10.1.99.44');
});

test('offline scans preserve previously cached devices', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'atvu-discovery-offline-'));
  let online = true;
  const cache = new DiscoveryCache(directory, async () => online ? [discovered('10.1.10.115')] : []);
  await cache.scan(1);
  online = false;
  const cached = await cache.scan(1);
  assert.equal(cached.length, 1);
  assert.equal(cached[0]?.host, '10.1.10.115');
});

test('a corrupt cache does not prevent fresh discovery', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'atvu-discovery-corrupt-'));
  const cacheDirectory = path.join(directory, 'androidtv-ultimate');
  await mkdir(cacheDirectory);
  await writeFile(path.join(cacheDirectory, 'discovery.json'), '{broken json');
  const cache = new DiscoveryCache(directory, async () => [discovered('10.1.10.115')]);
  const devices = await cache.scan(1);
  assert.equal(devices.length, 1);
  assert.equal(devices[0]?.host, '10.1.10.115');
});
