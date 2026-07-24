import path from 'node:path';
import type { AndroidTvDeviceConfig, CachedAndroidTv, DiscoveredAndroidTv } from '../types';
import { DISCOVERY_FILE, STORAGE_DIRECTORY } from '../settings';
import { readJsonFile, writePrivateJson } from '../storage/json-store';
import { discoverAndroidTvs, normalizeMac } from './discovery';

interface DiscoveryDocument {
  version: 1;
  devices: CachedAndroidTv[];
}

type DiscoveryFunction = (timeoutMs?: number) => Promise<DiscoveredAndroidTv[]>;

function sameText(left?: string, right?: string): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export class DiscoveryCache {
  private readonly file: string;
  private devices: CachedAndroidTv[] = [];
  private loaded = false;
  private scanPromise?: Promise<CachedAndroidTv[]>;
  private timer?: NodeJS.Timeout;

  constructor(storagePath: string, private readonly discover: DiscoveryFunction = discoverAndroidTvs) {
    this.file = path.join(storagePath, STORAGE_DIRECTORY, DISCOVERY_FILE);
  }

  async load(): Promise<CachedAndroidTv[]> {
    if (!this.loaded) {
      try {
        const document = await readJsonFile<DiscoveryDocument>(this.file, { version: 1, devices: [] });
        this.devices = Array.isArray(document.devices)
          ? document.devices.map(device => ({
            ...device,
            aliases: Array.isArray(device.aliases) ? device.aliases : [],
            txt: device.txt && typeof device.txt === 'object' ? device.txt : {},
          }))
          : [];
      } catch {
        // A corrupt cache must never prevent configured TVs from starting.
        this.devices = [];
      }
      this.loaded = true;
    }
    return this.list();
  }

  list(): CachedAndroidTv[] {
    return this.devices.map(device => ({ ...device, aliases: [...(device.aliases ?? [])], txt: { ...(device.txt ?? {}) } }));
  }

  async replace(devices: CachedAndroidTv[]): Promise<void> {
    this.devices = devices.map(device => ({
      ...device,
      aliases: [...(device.aliases ?? [])],
      txt: { ...(device.txt ?? {}) },
    }));
    this.loaded = true;
    await this.save();
  }

  async scan(timeoutMs = 4000): Promise<CachedAndroidTv[]> {
    if (this.scanPromise) {
      return this.scanPromise;
    }
    this.scanPromise = this.performScan(timeoutMs).finally(() => {
      this.scanPromise = undefined;
    });
    return this.scanPromise;
  }

  async resolveDevice(device: AndroidTvDeviceConfig): Promise<AndroidTvDeviceConfig> {
    await this.load();
    const match = this.find(device);
    if (!match) {
      return { ...device };
    }
    if (!match.aliases.includes(device.id)) {
      match.aliases.push(device.id);
      await this.save();
    }
    return {
      ...device,
      host: match.host,
      remotePort: match.port,
      discoveryId: match.discoveryId,
      serviceName: match.serviceName,
      hostname: match.hostname,
      mac: device.mac ?? match.mac,
      model: device.model ?? match.model,
      manufacturer: device.manufacturer ?? match.manufacturer,
    };
  }

  start(
    intervalSeconds: number,
    onRefresh: (devices: CachedAndroidTv[]) => void | Promise<void>,
    onError: (error: Error) => void,
  ): void {
    this.stop();
    const intervalMs = Math.max(15, intervalSeconds) * 1000;
    this.timer = setInterval(() => {
      void this.scan()
        .then(onRefresh)
        .catch(error => onError(error instanceof Error ? error : new Error(String(error))));
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async performScan(timeoutMs: number): Promise<CachedAndroidTv[]> {
    await this.load();
    const discovered = await this.discover(timeoutMs);
    const now = new Date().toISOString();
    let changed = false;
    for (const device of discovered) {
      const previous = this.findDiscovered(device);
      const aliases = new Set(previous?.aliases ?? []);
      if (previous && previous.id !== device.id) {
        aliases.add(device.id);
      }
      const cached: CachedAndroidTv = {
        ...previous,
        ...device,
        id: previous?.id ?? device.id,
        aliases: [...aliases],
        firstSeen: previous?.firstSeen ?? now,
        lastSeen: now,
        txt: { ...previous?.txt, ...device.txt },
      };
      if (previous) {
        const index = this.devices.indexOf(previous);
        this.devices[index] = cached;
      } else {
        this.devices.push(cached);
      }
      changed = true;
    }
    if (changed) {
      await this.save();
    }
    return this.list();
  }

  private find(device: AndroidTvDeviceConfig): CachedAndroidTv | undefined {
    const normalizedMac = normalizeMac(device.mac);
    const direct = this.devices.find(candidate => candidate.id === device.id || candidate.aliases.includes(device.id));
    if (direct) {
      return direct;
    }
    if (normalizedMac) {
      const byMac = this.devices.find(candidate => normalizeMac(candidate.mac) === normalizedMac);
      if (byMac) {
        return byMac;
      }
    }
    const byDiscoveryId = this.devices.find(candidate => sameText(candidate.discoveryId, device.discoveryId));
    if (byDiscoveryId) {
      return byDiscoveryId;
    }
    const byService = this.devices.find(candidate => sameText(candidate.serviceName, device.serviceName));
    if (byService) {
      return byService;
    }
    const byHostname = this.devices.find(candidate => sameText(candidate.hostname, device.hostname));
    if (byHostname) {
      return byHostname;
    }
    const byCurrentEndpoint = this.devices.find(candidate => candidate.host === device.host);
    if (byCurrentEndpoint) {
      return byCurrentEndpoint;
    }
    const sameName = this.devices.filter(candidate => sameText(candidate.name, device.name));
    return sameName.length === 1 ? sameName[0] : undefined;
  }

  private findDiscovered(device: DiscoveredAndroidTv): CachedAndroidTv | undefined {
    const mac = normalizeMac(device.mac);
    return this.devices.find(candidate => candidate.id === device.id
      || candidate.aliases.includes(device.id)
      || sameText(candidate.discoveryId, device.discoveryId)
      || Boolean(mac && normalizeMac(candidate.mac) === mac)
      || sameText(candidate.serviceName, device.serviceName)
      || sameText(candidate.hostname, device.hostname));
  }

  private async save(): Promise<void> {
    await writePrivateJson(this.file, { version: 1, devices: this.devices } satisfies DiscoveryDocument);
  }
}
