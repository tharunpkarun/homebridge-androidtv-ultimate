import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import tls from 'node:tls';
import type { AndroidTvDeviceConfig } from './types';
import { DiscoveryCache } from './network/discovery-cache';
import { frameMessage, FrameDecoder } from './protocol/framing';
import { PairingClient } from './protocol/pairing-client';
import { encodeConfigure } from './protocol/remote-messages';
import { CredentialStore } from './storage/credential-store';
import { previewLegacyMigration } from './storage/migration';

interface PairingSession {
  client: PairingClient;
  storage: CredentialStore;
}

const sessions = new Map<string, PairingSession>();

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
      resolve({ connected: true, latencyMs: Date.now() - started, protocol: 'Remote Service v2 (mutual TLS)' });
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

export async function diagnostics(storagePath: string): Promise<Record<string, unknown>> {
  const current = await status(storagePath);
  return {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    protocol: 'Android TV Remote Service v2',
    pairingPort: 6467,
    remotePort: 6466,
    paired: current.paired,
    statuses: current.statuses,
    discovered: current.discovered,
    credentialsIncluded: false,
  };
}
