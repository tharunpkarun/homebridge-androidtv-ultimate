import type {
  CharacteristicValue,
  Logger,
  PlatformAccessory,
  Service,
} from 'homebridge';
import type { AndroidTvPlatform } from '../platform';
import type { AndroidTvDeviceConfig, DeviceCredentials, DeviceSnapshot, LearnedInputMapping } from '../types';
import { AndroidKeyCode } from '../protocol/remote-messages';
import { RemoteServiceV2Transport } from '../protocol/v2-transport';
import type { AndroidTvTransport } from '../protocol/transport';
import { wakeOnLan } from '../network/wol';
import {
  ActiveInputLearner,
  applyLearnedMappings,
  assignInputIdentifiers,
  duplicateExplicitPackages,
  inputNeedsLearning,
  normalizePackageName,
  resolveInputIdentifier,
  type InputPackageBinding,
} from '../input/input-mapping';

interface InputBinding extends InputPackageBinding {
  service: Service;
}

export class AndroidTvAccessory {
  private readonly log: Logger;
  private readonly television: Service;
  private readonly speaker: Service;
  private readonly inputs: InputBinding[] = [];
  private readonly transport?: AndroidTvTransport;
  private readonly inputLearner: ActiveInputLearner;

  constructor(
    private readonly platform: AndroidTvPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: AndroidTvDeviceConfig,
    credentials?: DeviceCredentials,
    learnedMappings: LearnedInputMapping[] = [],
  ) {
    this.log = platform.log;
    this.inputLearner = new ActiveInputLearner((identifier, packageName) => this.completeLearning(identifier, packageName));
    const { Service, Characteristic } = platform;
    accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, device.manufacturer ?? 'Android TV')
      .setCharacteristic(Characteristic.Model, device.model ?? (device.deviceType === 'settopbox' ? 'Android TV Set-top Box' : 'Android TV'))
      .setCharacteristic(Characteristic.SerialNumber, device.id)
      .setCharacteristic(Characteristic.FirmwareRevision, 'Remote Service v2');

    this.television = accessory.getService(Service.Television)
      ?? accessory.addService(Service.Television, device.name, 'television');
    this.television
      .setCharacteristic(Characteristic.ConfiguredName, device.name)
      .setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    this.speaker = accessory.getService(Service.TelevisionSpeaker)
      ?? accessory.addService(Service.TelevisionSpeaker, `${device.name} Speaker`, 'speaker');
    this.speaker
      .setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
      .setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);
    this.television.addLinkedService(this.speaker);

    this.configureInputs(learnedMappings);
    this.configureCharacteristics();

    if (credentials) {
      this.transport = new RemoteServiceV2Transport(device, credentials, platform.disconnectGraceMs);
      this.transport.on('state', snapshot => this.handleState(snapshot));
      this.transport.on('error', error => {
        this.inputLearner.cancel();
        if (platform.debugEnabled) {
          this.log.debug('[%s] Remote connection: %s', device.name, error.message);
        }
      });
      this.transport.start();
    } else {
      this.log.warn('[%s] Not paired. Open the plugin settings to pair this TV.', device.name);
      this.handleState({ connection: 'offline', power: false });
    }
  }

  stop(): void {
    this.inputLearner.cancel();
    this.transport?.stop();
  }

  updateEndpoint(host: string, port: number): void {
    if (this.transport) {
      this.transport.updateEndpoint(host, port);
    } else {
      this.device.host = host;
      this.device.remotePort = port;
    }
  }

  private configureInputs(learnedMappings: LearnedInputMapping[]): void {
    const { Service, Characteristic } = this.platform;
    const configuredInputs = this.device.inputs ?? [];
    const identifiers = assignInputIdentifiers(configuredInputs);
    const duplicatePackages = duplicateExplicitPackages(configuredInputs);
    if (duplicatePackages.length > 0) {
      this.log.error(
        '[%s] Duplicate explicit app package mapping(s) ignored: %s',
        this.device.name,
        duplicatePackages.join(', '),
      );
    }
    for (const [index, input] of configuredInputs.entries()) {
      const identifier = identifiers[index]!;
      const service = this.accessory.getServiceById(Service.InputSource, `input-${identifier}`)
        ?? this.accessory.addService(Service.InputSource, input.name, `input-${identifier}`);
      service
        .setCharacteristic(Characteristic.Identifier, identifier)
        .setCharacteristic(Characteristic.ConfiguredName, input.name)
        .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION)
        .setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN)
        .setCharacteristic(Characteristic.TargetVisibilityState, Characteristic.TargetVisibilityState.SHOWN);
      this.television.addLinkedService(service);
      const packageName = normalizePackageName(input.packageName);
      this.inputs.push({
        identifier,
        name: input.name,
        uri: input.uri,
        packageName: packageName && !duplicatePackages.includes(packageName) ? packageName : undefined,
        service,
      });
    }
    applyLearnedMappings(this.inputs, learnedMappings);
  }

  private configureCharacteristics(): void {
    const { Characteristic } = this.platform;
    this.television.getCharacteristic(Characteristic.Active)
      .onGet(() => this.transport?.snapshot.power ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
      .onSet(async value => this.setActive(value === Characteristic.Active.ACTIVE));

    this.television.getCharacteristic(Characteristic.ActiveIdentifier)
      .onGet(() => this.currentIdentifier())
      .onSet(async value => {
        const input = this.inputs.find(item => item.identifier === Number(value));
        if (input) {
          if (inputNeedsLearning(input)) {
            this.inputLearner.begin(input.identifier, this.transport?.snapshot.currentApp);
          } else {
            this.inputLearner.cancel();
          }
          try {
            await this.requireTransport().launchApp(input.uri);
          } catch (error) {
            this.inputLearner.cancel();
            throw error;
          }
        }
      });

    this.television.getCharacteristic(Characteristic.RemoteKey)
      .onSet(async value => this.sendRemoteKey(Number(value)));
    this.television.getCharacteristic(Characteristic.PowerModeSelection)
      .onSet(async () => this.requireTransport().sendKey(AndroidKeyCode.MENU));

    this.speaker.getCharacteristic(Characteristic.Mute)
      .onGet(() => this.transport?.snapshot.muted ?? false)
      .onSet(async value => this.requireTransport().setMuted(Boolean(value)));
    this.speaker.getCharacteristic(Characteristic.Volume)
      .onGet(() => this.transport?.snapshot.volume ?? 0)
      .onSet(async value => this.requireTransport().setVolume(Number(value)));
    this.speaker.getCharacteristic(Characteristic.VolumeSelector)
      .onSet(async value => {
        const key = value === Characteristic.VolumeSelector.INCREMENT
          ? AndroidKeyCode.VOLUME_UP
          : AndroidKeyCode.VOLUME_DOWN;
        await this.requireTransport().sendKey(key);
      });
  }

  private async setActive(active: boolean): Promise<void> {
    if (!this.transport) {
      throw new Error(`${this.device.name} is not paired`);
    }
    if (active && this.transport.snapshot.connection !== 'online') {
      if (!this.device.mac) {
        throw new Error(`${this.device.name} is offline and has no Wake-on-LAN MAC address`);
      }
      await wakeOnLan(this.device.mac, this.device.broadcastAddress);
      return;
    }
    await this.transport.setPower(active);
  }

  private async sendRemoteKey(value: number): Promise<void> {
    const { Characteristic } = this.platform;
    const mapping = new Map<number, AndroidKeyCode>([
      [Characteristic.RemoteKey.REWIND, AndroidKeyCode.DPAD_LEFT],
      [Characteristic.RemoteKey.FAST_FORWARD, AndroidKeyCode.DPAD_RIGHT],
      [Characteristic.RemoteKey.NEXT_TRACK, AndroidKeyCode.DPAD_RIGHT],
      [Characteristic.RemoteKey.PREVIOUS_TRACK, AndroidKeyCode.DPAD_LEFT],
      [Characteristic.RemoteKey.ARROW_UP, AndroidKeyCode.DPAD_UP],
      [Characteristic.RemoteKey.ARROW_DOWN, AndroidKeyCode.DPAD_DOWN],
      [Characteristic.RemoteKey.ARROW_LEFT, AndroidKeyCode.DPAD_LEFT],
      [Characteristic.RemoteKey.ARROW_RIGHT, AndroidKeyCode.DPAD_RIGHT],
      [Characteristic.RemoteKey.SELECT, AndroidKeyCode.DPAD_CENTER],
      [Characteristic.RemoteKey.BACK, AndroidKeyCode.BACK],
      [Characteristic.RemoteKey.EXIT, AndroidKeyCode.HOME],
      [Characteristic.RemoteKey.PLAY_PAUSE, AndroidKeyCode.MEDIA_PLAY_PAUSE],
      [Characteristic.RemoteKey.INFORMATION, AndroidKeyCode.INFO],
    ]);
    const key = mapping.get(value);
    if (key !== undefined) {
      await this.requireTransport().sendKey(key);
    }
  }

  private handleState(snapshot: Readonly<DeviceSnapshot>): void {
    const { Characteristic } = this.platform;
    this.television.updateCharacteristic(
      Characteristic.Active,
      snapshot.power ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE,
    );
    const currentIdentifier = this.currentIdentifier(snapshot);
    this.television.updateCharacteristic(Characteristic.ActiveIdentifier, currentIdentifier);
    if (snapshot.connection !== 'online') {
      this.inputLearner.cancel();
    } else {
      this.inputLearner.observe(snapshot.currentApp, Number(currentIdentifier));
    }
    if (snapshot.muted !== undefined) {
      this.speaker.updateCharacteristic(Characteristic.Mute, snapshot.muted);
    }
    if (snapshot.volume !== undefined) {
      this.speaker.updateCharacteristic(Characteristic.Volume, snapshot.volume);
    }
    void this.platform.persistStatus(this.device, this.statusWithActiveInput(snapshot, Number(currentIdentifier)));
  }

  private currentIdentifier(snapshot = this.transport?.snapshot): CharacteristicValue {
    if (!snapshot?.currentApp) {
      return 0;
    }
    return resolveInputIdentifier(this.inputs, snapshot.currentApp);
  }

  private statusWithActiveInput(snapshot: Readonly<DeviceSnapshot>, identifier: number): DeviceSnapshot {
    const input = this.inputs.find(item => item.identifier === identifier);
    return {
      ...snapshot,
      currentInputIdentifier: input?.identifier,
      currentInputName: input?.name,
    };
  }

  private async completeLearning(identifier: number, packageName: string): Promise<void> {
    try {
      const mappings = await this.platform.learnInputMapping(this.device.id, identifier, packageName);
      applyLearnedMappings(this.inputs, mappings);
      const currentIdentifier = Number(this.currentIdentifier());
      if (currentIdentifier === identifier) {
        this.television.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, currentIdentifier);
        if (this.transport) {
          await this.platform.persistStatus(
            this.device,
            this.statusWithActiveInput(this.transport.snapshot, currentIdentifier),
          );
        }
      }
      const input = this.inputs.find(item => item.identifier === identifier);
      this.log.info('[%s] Learned Android package %s for Apple Home input %s.', this.device.name, packageName, input?.name ?? identifier);
    } catch (error) {
      this.log.warn('[%s] Could not save learned app package %s: %s', this.device.name, packageName, String(error));
    }
  }

  private requireTransport(): AndroidTvTransport {
    if (!this.transport) {
      throw new Error(`${this.device.name} is not paired`);
    }
    return this.transport;
  }
}
