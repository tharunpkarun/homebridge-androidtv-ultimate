import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { DiscoveryCache } from '../network/discovery-cache';
import type {
  AndroidTvPlatformConfig,
  CachedAndroidTv,
  DeviceCredentials,
  PersistedStatus,
} from '../types';
import { CredentialStore } from './credential-store';

const BACKUP_FORMAT = 'androidtv-ultimate-encrypted-backup';
const PAYLOAD_FORMAT = 'androidtv-ultimate-plugin-data';
const BACKUP_VERSION = 1;

export interface EncryptedPluginBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  pluginVersion: string;
  encryption: {
    algorithm: 'aes-256-gcm';
    keyDerivation: 'scrypt';
    salt: string;
    iv: string;
    authenticationTag: string;
  };
  ciphertext: string;
}

interface PluginBackupPayload {
  format: typeof PAYLOAD_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  pluginVersion: string;
  config: AndroidTvPlatformConfig;
  credentials: DeviceCredentials[];
  discovery: CachedAndroidTv[];
  statuses: PersistedStatus[];
}

function assertPassphrase(passphrase: string): void {
  if (passphrase.length < 8) {
    throw new Error('Backup passphrase must contain at least 8 characters');
  }
}

function isEncryptedBackup(value: unknown): value is EncryptedPluginBackup {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<EncryptedPluginBackup>;
  return candidate.format === BACKUP_FORMAT
    && candidate.version === BACKUP_VERSION
    && typeof candidate.ciphertext === 'string'
    && typeof candidate.encryption?.salt === 'string'
    && typeof candidate.encryption.iv === 'string'
    && typeof candidate.encryption.authenticationTag === 'string';
}

function validatePayload(value: unknown): PluginBackupPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Backup payload is not an object');
  }
  const payload = value as Partial<PluginBackupPayload>;
  if (payload.format !== PAYLOAD_FORMAT || payload.version !== BACKUP_VERSION) {
    throw new Error('This backup format or version is not supported');
  }
  if (!payload.config || typeof payload.config !== 'object'
    || !Array.isArray(payload.credentials)
    || !Array.isArray(payload.discovery)
    || !Array.isArray(payload.statuses)) {
    throw new Error('Backup payload is incomplete');
  }
  return payload as PluginBackupPayload;
}

export async function createEncryptedBackup(
  storagePath: string,
  config: AndroidTvPlatformConfig,
  pluginVersion: string,
  passphrase: string,
): Promise<EncryptedPluginBackup> {
  assertPassphrase(passphrase);
  const store = new CredentialStore(storagePath);
  const discoveryCache = new DiscoveryCache(storagePath);
  await discoveryCache.load();
  const createdAt = new Date().toISOString();
  const payload: PluginBackupPayload = {
    format: PAYLOAD_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    pluginVersion,
    config,
    credentials: await store.exportAll(),
    discovery: discoveryCache.list(),
    statuses: await store.readStatuses(),
  };

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${BACKUP_FORMAT}:${BACKUP_VERSION}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    pluginVersion,
    encryption: {
      algorithm: 'aes-256-gcm',
      keyDerivation: 'scrypt',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authenticationTag: cipher.getAuthTag().toString('base64'),
    },
    ciphertext: ciphertext.toString('base64'),
  };
}

export async function restoreEncryptedBackup(
  storagePath: string,
  backup: unknown,
  passphrase: string,
): Promise<{
  config: AndroidTvPlatformConfig;
  createdAt: string;
  sourcePluginVersion: string;
  restored: { devices: number; credentials: number; discovered: number; statuses: number };
}> {
  assertPassphrase(passphrase);
  if (!isEncryptedBackup(backup)) {
    throw new Error('Select a valid AndroidTV Ultimate encrypted backup file');
  }

  let payload: PluginBackupPayload;
  try {
    const salt = Buffer.from(backup.encryption.salt, 'base64');
    const iv = Buffer.from(backup.encryption.iv, 'base64');
    const authenticationTag = Buffer.from(backup.encryption.authenticationTag, 'base64');
    const key = scryptSync(passphrase, salt, 32);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`${BACKUP_FORMAT}:${BACKUP_VERSION}`));
    decipher.setAuthTag(authenticationTag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(backup.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    payload = validatePayload(JSON.parse(plaintext));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('This backup')) {
      throw error;
    }
    throw new Error('Could not decrypt this backup; check the file and passphrase');
  }

  const store = new CredentialStore(storagePath);
  await store.replaceAll(payload.credentials);
  await store.replaceStatuses(payload.statuses);
  await new DiscoveryCache(storagePath).replace(payload.discovery);

  return {
    config: payload.config,
    createdAt: payload.createdAt,
    sourcePluginVersion: payload.pluginVersion,
    restored: {
      devices: payload.config.devices?.length ?? 0,
      credentials: payload.credentials.length,
      discovered: payload.discovery.length,
      statuses: payload.statuses.length,
    },
  };
}
