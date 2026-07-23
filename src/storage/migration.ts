import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AndroidTvDeviceConfig, DeviceCredentials, MigrationPreview } from '../types';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function text(...values: unknown[]): string | undefined {
  return values.find(value => typeof value === 'string' && value.trim().length > 0) as string | undefined;
}

function stableId(value: string): string {
  return createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 16);
}

function credentialFrom(source: JsonObject | undefined, deviceId: string, clientName: string): DeviceCredentials | undefined {
  if (!source) {
    return undefined;
  }
  const certificate = text(source.certificate, source.cert, source.clientCertificate);
  const privateKey = text(source.privateKey, source.key, source.clientKey);
  if (!certificate || !privateKey || !certificate.includes('BEGIN CERTIFICATE') || !privateKey.includes('PRIVATE KEY')) {
    return undefined;
  }
  return {
    deviceId,
    certificate,
    privateKey,
    clientName,
    fingerprint: text(source.fingerprint) ?? 'legacy-import',
    pairedAt: text(source.pairedAt) ?? new Date().toISOString(),
    protocol: 'remote-service-v2',
  };
}

export async function previewLegacyMigration(storagePath: string): Promise<MigrationPreview> {
  const candidates = [...new Set([
    path.join(storagePath, 'androidtv-config.json'),
    '/var/lib/homebridge/androidtv-config.json',
  ])];
  let source = candidates[0] ?? path.join(storagePath, 'androidtv-config.json');
  let raw: JsonObject | undefined;
  for (const candidate of candidates) {
    try {
      raw = object(JSON.parse(await readFile(candidate, 'utf8')));
      source = candidate;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { source: candidate, found: true, devices: [], credentials: [], warnings: [`Could not parse legacy file: ${String(error)}`] };
      }
    }
  }
  if (!raw) {
    return { source, found: false, devices: [], credentials: [], warnings: [] };
  }

  const rawDevices = Array.isArray(raw.devices)
    ? raw.devices
    : Array.isArray(raw.tvs)
      ? raw.tvs
      : object(raw.config) && Array.isArray(object(raw.config)?.devices)
        ? object(raw.config)?.devices as unknown[]
        : [];
  const credentialsRoot = object(raw.credentials) ?? object(raw.pairedClients) ?? {};
  const devices: AndroidTvDeviceConfig[] = [];
  const credentials: DeviceCredentials[] = [];
  const warnings: string[] = [];

  for (const value of rawDevices) {
    const legacy = object(value);
    if (!legacy) {
      continue;
    }
    const host = text(legacy.host, legacy.ip, legacy.address);
    const name = text(legacy.name, legacy.displayName, legacy.model) ?? host;
    if (!host || !name) {
      warnings.push('Skipped a legacy TV without both a name and host/IP address.');
      continue;
    }
    const id = text(legacy.id, legacy.uuid, legacy.deviceId) ?? stableId(`${name}:${host}`);
    devices.push({
      id,
      name,
      host,
      remotePort: typeof legacy.remotePort === 'number' ? legacy.remotePort : 6466,
      pairingPort: typeof legacy.pairingPort === 'number' ? legacy.pairingPort : 6467,
      model: text(legacy.model),
      manufacturer: text(legacy.manufacturer, legacy.vendor),
      mac: text(legacy.mac, legacy.macAddress),
      broadcastAddress: text(legacy.broadcastAddress),
      deviceType: legacy.deviceType === 'settopbox' ? 'settopbox' : 'television',
    });
    const byId = object(credentialsRoot[id]) ?? object(credentialsRoot[name]);
    const imported = credentialFrom(byId ?? legacy, id, text(legacy.clientName) ?? 'Homebridge AndroidTV Ultimate');
    if (imported) {
      credentials.push(imported);
    } else {
      warnings.push(`${name}: no reusable Remote Service v2 certificate was found; pair this TV again.`);
    }
  }

  if ('username' in raw || 'pin' in raw || 'pincode' in raw) {
    warnings.push('Legacy Apple Home identity fields were intentionally not imported.');
  }
  return { source, found: true, devices, credentials, warnings };
}
