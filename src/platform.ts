import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  Service,
} from 'homebridge';
import { AndroidTvAccessory } from './accessory/android-tv-accessory';
import { CredentialStore } from './storage/credential-store';
import type { AndroidTvDeviceConfig, AndroidTvPlatformConfig, DeviceSnapshot } from './types';
import { DEFAULT_DISCOVERY_INTERVAL_SECONDS, PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { DiscoveryCache } from './network/discovery-cache';

export class AndroidTvPlatform implements DynamicPlatformPlugin {
  readonly Service: typeof Service;
  readonly Characteristic: typeof Characteristic;
  readonly disconnectGraceMs: number;
  readonly debugEnabled: boolean;
  private readonly cachedAccessories = new Map<string, PlatformAccessory>();
  private readonly handlers = new Map<string, AndroidTvAccessory>();
  private readonly credentialStore: CredentialStore;
  private readonly discoveryCache: DiscoveryCache;
  private readonly runtimeDevices = new Map<string, AndroidTvDeviceConfig>();

  constructor(
    readonly log: Logger,
    private readonly config: AndroidTvPlatformConfig,
    private readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.disconnectGraceMs = config.disconnectGraceMs ?? 2500;
    this.debugEnabled = config.debug === true;
    this.credentialStore = new CredentialStore(api.user.storagePath());
    this.discoveryCache = new DiscoveryCache(api.user.storagePath());

    api.on('didFinishLaunching', () => void this.launch());
    api.on('shutdown', () => {
      this.discoveryCache.stop();
      for (const handler of this.handlers.values()) {
        handler.stop();
      }
    });
  }

  private async launch(): Promise<void> {
    await this.discoveryCache.load();
    try {
      const discovered = await this.discoveryCache.scan();
      this.log.info('mDNS discovery cache contains %d Android TV device(s).', discovered.length);
    } catch (error) {
      this.log.warn('Initial mDNS discovery failed; using cached endpoints: %s', String(error));
    }
    await this.synchronizeAccessories();
    this.discoveryCache.start(
      this.config.discoveryIntervalSeconds ?? DEFAULT_DISCOVERY_INTERVAL_SECONDS,
      () => this.refreshEndpoints(),
      error => this.log.debug('Periodic mDNS discovery failed: %s', error.message),
    );
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  async persistStatus(device: AndroidTvDeviceConfig, snapshot: Readonly<DeviceSnapshot>): Promise<void> {
    try {
      await this.credentialStore.writeStatus({
        deviceId: device.id,
        host: device.host,
        updatedAt: new Date().toISOString(),
        ...snapshot,
      });
    } catch (error) {
      this.log.debug('[%s] Could not persist status: %s', device.name, String(error));
    }
  }

  private async synchronizeAccessories(): Promise<void> {
    const configured = (this.config.devices ?? []).filter(device => device.id && device.name && device.host);
    const expected = new Set<string>();
    for (const configuredDevice of configured) {
      const device = await this.discoveryCache.resolveDevice(configuredDevice);
      this.runtimeDevices.set(device.id, device);
      const uuid = this.api.hap.uuid.generate(`androidtv-ultimate:${device.id}`);
      expected.add(uuid);
      let accessory = this.cachedAccessories.get(uuid);
      if (!accessory) {
        accessory = new this.api.platformAccessory(device.name, uuid);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.cachedAccessories.set(uuid, accessory);
      }
      accessory.displayName = device.name;
      accessory.context.deviceId = device.id;
      const credentials = await this.credentialStore.get(device.id);
      const previous = this.handlers.get(uuid);
      previous?.stop();
      this.handlers.set(uuid, new AndroidTvAccessory(this, accessory, device, credentials));
      this.log.info('[%s] %s at %s:%d', device.name, credentials ? 'Ready' : 'Awaiting pairing', device.host, device.remotePort ?? 6466);
    }

    const stale = [...this.cachedAccessories.entries()]
      .filter(([uuid]) => !expected.has(uuid))
      .map(([, accessory]) => accessory);
    if (stale.length > 0) {
      for (const accessory of stale) {
        this.handlers.get(accessory.UUID)?.stop();
        this.handlers.delete(accessory.UUID);
        this.cachedAccessories.delete(accessory.UUID);
      }
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
  }

  private async refreshEndpoints(): Promise<void> {
    for (const configured of this.config.devices ?? []) {
      const current = this.runtimeDevices.get(configured.id);
      const resolved = await this.discoveryCache.resolveDevice(current ?? configured);
      if (!current) {
        continue;
      }
      const previousHost = current.host;
      const previousPort = current.remotePort ?? 6466;
      const nextPort = resolved.remotePort ?? 6466;
      if (previousHost === resolved.host && previousPort === nextPort) {
        Object.assign(current, resolved);
        continue;
      }
      const uuid = this.api.hap.uuid.generate(`androidtv-ultimate:${configured.id}`);
      this.log.info('[%s] mDNS endpoint changed from %s:%d to %s:%d.', configured.name, previousHost, previousPort, resolved.host, nextPort);
      this.handlers.get(uuid)?.updateEndpoint(resolved.host, nextPort);
      Object.assign(current, resolved);
    }
  }
}
