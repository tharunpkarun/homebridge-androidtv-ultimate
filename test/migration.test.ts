import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { previewLegacyMigration } from '../src/storage/migration';

test('migration imports TV config but refuses Apple Home identity', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'atvu-migration-'));
  await writeFile(path.join(directory, 'androidtv-config.json'), JSON.stringify({
    username: 'AA:BB:CC:DD:EE:FF',
    pin: '031-45-154',
    devices: [{ name: 'Percee TV', ip: '10.1.99.20', mac: 'AA:BB:CC:DD:EE:FF' }],
  }));
  const preview = await previewLegacyMigration(directory);
  assert.equal(preview.found, true);
  assert.equal(preview.devices.length, 1);
  assert.equal(preview.devices[0]?.name, 'Percee TV');
  assert.equal(preview.credentials.length, 0);
  assert.ok(preview.warnings.some(warning => warning.includes('Apple Home identity')));
});
