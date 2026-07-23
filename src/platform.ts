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
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

export class AndroidTvPlatform implements DynamicPlatformPlugin {
  readonly Service: typeof Service;
  readonly Characteristic: typeof Characteristic;
  readonly disconnectGraceMs: number;
  readonly debugEnabled: boolean;
  private readonly cachedAccessories = new Map<string, PlatformAccessory>();
  private readonly handlers = new Map<string, AndroidTvAccessory>();
  private readonly credentialStore: CredentialStore;

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

    api.on('didFinishLaunching', () => void this.synchronizeAccessories());
    api.on('shutdown', () => {
      for (const handler of this.handlers.values()) {
        handler.stop();
      }
    });
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
    for (const device of configured) {
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
}
