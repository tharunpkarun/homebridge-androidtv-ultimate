import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import type { AndroidTvDeviceConfig, AndroidTvPlatformConfig } from './types';
import { DiscoveryCache } from './network/discovery-cache';
import { frameMessage, FrameDecoder } from './protocol/framing';
import { PairingClient } from './protocol/pairing-client';
import { encodeConfigure } from './protocol/remote-messages';
import { CredentialStore } from './storage/credential-store';
import { createEncryptedBackup, restoreEncryptedBackup } from './storage/backup';
import { previewLegacyMigration } from './storage/migration';

interface PairingSession {
  client: PairingClient;
  storage: CredentialStore;
}

const sessions = new Map<string, PairingSession>();

interface PackageManifest {
  name?: string;
  displayName?: string;
  version?: string;
  description?: string;
  homepage?: string;
  repository?: { url?: string } | string;
  bugs?: { url?: string } | string;
  engines?: Record<string, string>;
  license?: string;
  author?: { name?: string; url?: string } | string;
}

function manifestUrl(value?: { url?: string } | string): string | undefined {
  if (typeof value === 'string') {
    return value.replace(/^git\+/, '').replace(/\.git$/, '');
  }
  return value?.url?.replace(/^git\+/, '').replace(/\.git$/, '');
}

export async function about(): Promise<Record<string, unknown>> {
  let source: string | undefined;
  for (const candidate of [path.join(__dirname, '..', 'package.json'), path.join(process.cwd(), 'package.json')]) {
    try {
      source = await readFile(candidate, 'utf8');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  if (!source) {
    throw new Error('Could not locate the plugin package manifest');
  }
  const manifest = JSON.parse(source) as PackageManifest;
  return {
    name: manifest.name,
    displayName: manifest.displayName,
    version: manifest.version,
    description: manifest.description,
    license: manifest.license,
    author: manifest.author,
    homepage: manifest.homepage,
    repository: manifestUrl(manifest.repository),
    bugs: manifestUrl(manifest.bugs),
    engines: manifest.engines,
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
  };
}

export async function exportBackup(
  storagePath: string,
  config: AndroidTvPlatformConfig,
  passphrase: string,
) {
  const packageDetails = await about();
  return createEncryptedBackup(storagePath, config, String(packageDetails.version ?? 'unknown'), passphrase);
}

export async function importBackup(
  storagePath: string,
  backup: unknown,
  passphrase: string,
): ReturnType<typeof restoreEncryptedBackup> {
  return restoreEncryptedBackup(storagePath, backup, passphrase);
}

export async function discover(storagePath: string) {
  return new DiscoveryCache(storagePath).scan();
}

export async function beginPairing(
  storagePath: string,
  device: Pick<AndroidTvDeviceConfig, 'id' | 'name' | 'host' | 'pairingPort'>,
): Promise<{ sessionId: string; state: string; fingerprint: string }> {
  if (!device.id || !device.name || !device.host) {
    throw new Error('Device ID, name, and host are required');
  }
  const sessionId = randomUUID();
  const client = new PairingClient(
    device.id,
    device.host,
    device.pairingPort ?? 6467,
    `Homebridge ${device.name}`,
  );
  const session = { client, storage: new CredentialStore(storagePath) };
  sessions.set(sessionId, session);
  try {
    const prompt = await client.start();
    return { sessionId, state: prompt.state, fingerprint: prompt.fingerprint };
  } catch (error) {
    sessions.delete(sessionId);
    client.close();
    throw error;
  }
}

export async function completePairing(
  sessionId: string,
  code: string,
): Promise<{ deviceId: string; fingerprint: string; pairedAt: string }> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('Pairing session expired; start pairing again');
  }
  try {
    const credentials = await session.client.submitCode(code);
    await session.storage.set(credentials);
    return {
      deviceId: credentials.deviceId,
      fingerprint: credentials.fingerprint,
      pairedAt: credentials.pairedAt,
    };
  } finally {
    session.client.close();
    sessions.delete(sessionId);
  }
}

export function cancelPairing(sessionId: string): void {
  sessions.get(sessionId)?.client.close();
  sessions.delete(sessionId);
}

export async function status(storagePath: string): Promise<{
  paired: Awaited<ReturnType<CredentialStore['list']>>;
  statuses: Awaited<ReturnType<CredentialStore['readStatuses']>>;
  discovered: ReturnType<DiscoveryCache['list']>;
}> {
  const store = new CredentialStore(storagePath);
  const discovery = new DiscoveryCache(storagePath);
  await discovery.load();
  return { paired: await store.list(), statuses: await store.readStatuses(), discovered: discovery.list() };
}

export async function testConnection(storagePath: string, device: AndroidTvDeviceConfig): Promise<{
  connected: true;
  latencyMs: number;
  protocol: string;
  host: string;
  port: number;
  testedAt: string;
}> {
  const credentials = await new CredentialStore(storagePath).get(device.id);
  if (!credentials) {
    throw new Error('This TV has not been paired');
  }
  const discovery = new DiscoveryCache(storagePath);
  await discovery.load();
  const resolved = await discovery.resolveDevice(device);
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const decoder = new FrameDecoder();
    const socket = tls.connect({
      host: resolved.host,
      port: resolved.remotePort ?? 6466,
      cert: credentials.certificate,
      key: credentials.privateKey,
      rejectUnauthorized: false,
      ...(isIP(resolved.host) === 0 ? { servername: resolved.host } : {}),
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Connection test timed out after 10 seconds'));
    }, 10_000);
    timer.unref();
    const finish = (): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve({
        connected: true,
        latencyMs: Date.now() - started,
        protocol: 'Remote Service v2 (mutual TLS)',
        host: resolved.host,
        port: resolved.remotePort ?? 6466,
        testedAt: new Date().toISOString(),
      });
    };
    socket.once('secureConnect', () => socket.write(frameMessage(encodeConfigure(credentials.clientName))));
    socket.on('data', data => {
      if (decoder.push(data).length > 0) {
        finish();
      }
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function migrationPreview(storagePath: string): ReturnType<typeof previewLegacyMigration> {
  return previewLegacyMigration(storagePath);
}

export async function applyMigration(storagePath: string): Promise<Awaited<ReturnType<typeof previewLegacyMigration>>> {
  const preview = await previewLegacyMigration(storagePath);
  if (preview.credentials.length > 0) {
    await new CredentialStore(storagePath).setMany(preview.credentials);
  }
  return preview;
}

export async function diagnostics(
  storagePath: string,
  includeNetworkIdentifiers = false,
): Promise<Record<string, unknown>> {
  const current = await status(storagePath);
  const paired = includeNetworkIdentifiers
    ? current.paired
    : current.paired.map(item => ({
      ...item,
      deviceId: '<redacted>',
      fingerprint: '<redacted>',
      clientName: '<redacted>',
    }));
  const statuses = includeNetworkIdentifiers
    ? current.statuses
    : current.statuses.map(item => ({
      ...item,
      deviceId: '<redacted>',
      host: '<redacted>',
    }));
  const discovered = includeNetworkIdentifiers
    ? current.discovered
    : current.discovered.map(item => ({
      name: '<redacted>',
      id: '<redacted>',
      discoveryId: '<redacted>',
      host: '<redacted>',
      port: item.port,
      serviceName: '<redacted>',
      hostname: '<redacted>',
      mac: item.mac ? '<redacted>' : undefined,
      model: item.model,
      manufacturer: item.manufacturer,
      txtKeys: Object.keys(item.txt ?? {}).sort(),
      aliasCount: item.aliases.length,
      firstSeen: item.firstSeen,
      lastSeen: item.lastSeen,
    }));
  return {
    generatedAt: new Date().toISOString(),
    package: await about(),
    protocol: 'Android TV Remote Service v2',
    pairingPort: 6467,
    remotePort: 6466,
    paired,
    statuses,
    discovered,
    credentialsIncluded: false,
    networkIdentifiersIncluded: includeNetworkIdentifiers,
  };
}
