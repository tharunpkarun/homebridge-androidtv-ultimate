import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DiscoveryCache } from '../src/network/discovery-cache';
import { createEncryptedBackup, restoreEncryptedBackup } from '../src/storage/backup';
import { CredentialStore } from '../src/storage/credential-store';
import { InputMappingStore } from '../src/storage/input-mapping-store';
import { diagnostics } from '../src/ui-api';
import type { AndroidTvPlatformConfig, CachedAndroidTv, DeviceCredentials, PersistedStatus } from '../src/types';

const credentials: DeviceCredentials = {
  deviceId: 'living-room-tv',
  certificate: 'PRIVATE CERTIFICATE MATERIAL',
  privateKey: 'PRIVATE KEY MATERIAL',
  clientName: 'Homebridge Living Room TV',
  fingerprint: 'AA:BB:CC',
  pairedAt: '2026-07-24T01:00:00.000Z',
  protocol: 'remote-service-v2',
};

const discovered: CachedAndroidTv = {
  id: 'discovered-tv',
  aliases: ['living-room-tv'],
  discoveryId: 'AA:BB:CC:DD:EE:FF',
  name: 'Living Room TV',
  host: '10.1.10.115',
  port: 6466,
  serviceName: 'Living Room TV._androidtvremote2._tcp.local',
  hostname: 'living-room-tv.local',
  mac: 'AA:BB:CC:DD:EE:FF',
  manufacturer: 'Example',
  model: 'Example TV',
  txt: { bt: 'AA:BB:CC:DD:EE:FF' },
  firstSeen: '2026-07-24T01:00:00.000Z',
  lastSeen: '2026-07-24T01:05:00.000Z',
};

const status: PersistedStatus = {
  deviceId: 'living-room-tv',
  host: '10.1.10.115',
  connection: 'online',
  power: true,
  volume: 25,
  muted: false,
  lastSeen: '2026-07-24T01:05:00.000Z',
  updatedAt: '2026-07-24T01:05:00.000Z',
};

const config: AndroidTvPlatformConfig = {
  platform: 'AndroidTVUltimate',
  name: 'AndroidTV Ultimate',
  devices: [{
    id: 'living-room-tv',
    name: 'Living Room TV',
    host: '10.1.10.115',
    mac: 'AA:BB:CC:DD:EE:FF',
  }],
};

function withoutInputMappings<T extends Awaited<ReturnType<typeof createEncryptedBackup>>>(backup: T): T {
  const salt = Buffer.from(backup.encryption.salt, 'base64');
  const oldIv = Buffer.from(backup.encryption.iv, 'base64');
  const key = scryptSync('correct horse battery staple', salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, oldIv);
  decipher.setAAD(Buffer.from('androidtv-ultimate-encrypted-backup:1'));
  decipher.setAuthTag(Buffer.from(backup.encryption.authenticationTag, 'base64'));
  const payload = JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(backup.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')) as Record<string, unknown>;
  delete payload.inputMappings;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('androidtv-ultimate-encrypted-backup:1'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return {
    ...backup,
    encryption: {
      ...backup.encryption,
      iv: iv.toString('base64'),
      authenticationTag: cipher.getAuthTag().toString('base64'),
    },
    ciphertext: ciphertext.toString('base64'),
  };
}

test('encrypted backup restores config, pairing credentials, discovery, and status', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'atvu-backup-source-'));
  const target = await mkdtemp(path.join(tmpdir(), 'atvu-backup-target-'));
  const sourceStore = new CredentialStore(source);
  await sourceStore.set(credentials);
  await sourceStore.replaceStatuses([status]);
  await new DiscoveryCache(source).replace([discovered]);
  await new InputMappingStore(source).learn('living-room-tv', 1, 'com.example.streaming');

  const backup = await createEncryptedBackup(source, config, '0.2.0', 'correct horse battery staple');
  const serialized = JSON.stringify(backup);
  assert.equal(serialized.includes(credentials.privateKey), false);
  assert.equal(serialized.includes(credentials.certificate), false);
  assert.equal(serialized.includes(discovered.host), false);
  assert.equal(serialized.includes('com.example.streaming'), false);
  await assert.rejects(
    restoreEncryptedBackup(target, backup, 'incorrect passphrase'),
    /Could not decrypt this backup/,
  );

  const restored = await restoreEncryptedBackup(target, backup, 'correct horse battery staple');
  assert.equal(restored.config.devices?.[0]?.name, 'Living Room TV');
  assert.equal(restored.restored.credentials, 1);
  assert.equal((await new CredentialStore(target).get('living-room-tv'))?.privateKey, credentials.privateKey);
  const restoredDiscovery = new DiscoveryCache(target);
  await restoredDiscovery.load();
  assert.equal(restoredDiscovery.list()[0]?.host, '10.1.10.115');
  assert.equal((await new CredentialStore(target).readStatuses())[0]?.power, true);
  assert.equal((await new InputMappingStore(target).list('living-room-tv'))[0]?.packageName, 'com.example.streaming');
  assert.equal(restored.restored.inputMappings, 1);
});

test('older encrypted backups without app mappings remain restorable', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'atvu-backup-legacy-source-'));
  const target = await mkdtemp(path.join(tmpdir(), 'atvu-backup-legacy-target-'));
  const backup = await createEncryptedBackup(source, config, '0.2.0', 'correct horse battery staple');
  await restoreEncryptedBackup(target, withoutInputMappings(backup), 'correct horse battery staple');
  assert.deepEqual(await new InputMappingStore(target).list(), []);
});

test('backup requires a non-trivial passphrase', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'atvu-backup-passphrase-'));
  await assert.rejects(
    createEncryptedBackup(source, config, '0.2.0', 'short'),
    /at least 8 characters/,
  );
});

test('support diagnostics redact network and pairing identifiers by default', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'atvu-diagnostics-'));
  const store = new CredentialStore(source);
  await store.set(credentials);
  await store.replaceStatuses([status]);
  await new DiscoveryCache(source).replace([discovered]);
  await new InputMappingStore(source).learn('living-room-tv', 1, 'com.example.streaming');

  const safe = JSON.stringify(await diagnostics(source));
  assert.equal(safe.includes('10.1.10.115'), false);
  assert.equal(safe.includes('Living Room TV'), false);
  assert.equal(safe.includes('AA:BB:CC:DD:EE:FF'), false);
  assert.equal(safe.includes(credentials.fingerprint), false);
  assert.equal(safe.includes(credentials.privateKey), false);
  assert.equal(safe.includes('com.example.streaming'), false);

  const detailed = JSON.stringify(await diagnostics(source, true));
  assert.equal(detailed.includes('10.1.10.115'), true);
  assert.equal(detailed.includes('Living Room TV'), true);
  assert.equal(detailed.includes(credentials.privateKey), false);
  assert.equal(detailed.includes('com.example.streaming'), true);
});
