import type { PlatformConfig } from 'homebridge';

export interface AppInputConfig {
  name: string;
  uri: string;
  identifier?: number;
}

export interface AndroidTvDeviceConfig {
  id: string;
  name: string;
  host: string;
  remotePort?: number;
  pairingPort?: number;
  model?: string;
  manufacturer?: string;
  mac?: string;
  broadcastAddress?: string;
  deviceType?: 'television' | 'settopbox';
  inputs?: AppInputConfig[];
}

export interface AndroidTvPlatformConfig extends PlatformConfig {
  name?: string;
  debug?: boolean;
  disconnectGraceMs?: number;
  devices?: AndroidTvDeviceConfig[];
}

export interface DeviceCredentials {
  deviceId: string;
  certificate: string;
  privateKey: string;
  clientName: string;
  fingerprint: string;
  pairedAt: string;
  protocol: 'remote-service-v2';
}

export type ConnectionState = 'offline' | 'connecting' | 'online';

export interface DeviceSnapshot {
  connection: ConnectionState;
  power: boolean;
  volume?: number;
  muted?: boolean;
  currentApp?: string;
  lastSeen?: string;
  error?: string;
}

export interface PersistedStatus extends DeviceSnapshot {
  deviceId: string;
  host: string;
  updatedAt: string;
}

export interface DiscoveredAndroidTv {
  id: string;
  name: string;
  host: string;
  port: number;
  model?: string;
  manufacturer?: string;
  txt: Record<string, string>;
}

export interface MigrationPreview {
  source: string;
  found: boolean;
  devices: AndroidTvDeviceConfig[];
  credentials: DeviceCredentials[];
  warnings: string[];
}
