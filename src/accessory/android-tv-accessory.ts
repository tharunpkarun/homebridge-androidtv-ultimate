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
import { applyHomeKitPresentation, homeKitPresentation, homeKitProfileLabel } from '../homekit/presentation';
import { inputSourceType, resolveControlOptions, type ResolvedControlOptions } from '../homekit/controls';
import type { AndroidRemoteKeyName } from '../types';
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
import {
  activateCecWakeHelper,
  isCecWakeHelperRouteAvailable,
  resolveCecWakeConfig,
  runCecWakeAttempt,
  type CecWakeAttemptResult,
} from '../power/cec-wake';

interface InputBinding extends InputPackageBinding {
  service: Service;
  type?: NonNullable<AndroidTvDeviceConfig['inputs']>[number]['type'];
}

export class AndroidTvAccessory {
  private readonly log: Logger;
  private readonly television: Service;
  private readonly speaker: Service;
  private readonly smartSpeaker?: Service;
  private readonly audioService: Service;
  private readonly controls: ResolvedControlOptions;
  private readonly inputs: InputBinding[] = [];
  private readonly transport?: AndroidTvTransport;
  private readonly inputLearner: ActiveInputLearner;
  private smartMediaState = 2;
  private wakeAttempt?: Promise<void>;
  private communicationFailure?: { kind: Exclude<CecWakeAttemptResult, 'online'>; reason: string };
  private stopped = false;

  constructor(
    private readonly platform: AndroidTvPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: AndroidTvDeviceConfig,
    credentials?: DeviceCredentials,
    learnedMappings: LearnedInputMapping[] = [],
  ) {
    this.log = platform.log;
    this.controls = resolveControlOptions(device);
    this.inputLearner = new ActiveInputLearner((identifier, packageName) => this.completeLearning(identifier, packageName));
    const { Service, Characteristic } = platform;
    accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, device.manufacturer ?? 'Android TV')
      .setCharacteristic(Characteristic.Model, device.model ?? `Android TV ${homeKitProfileLabel(device.deviceType)}`)
      .setCharacteristic(Characteristic.SerialNumber, device.id)
      .setCharacteristic(Characteristic.FirmwareRevision, 'Remote Service v2');

    this.television = accessory.getService(Service.Television)
      ?? accessory.addService(Service.Television, device.name, 'television');
    this.television
      .setCharacteristic(Characteristic.ConfiguredName, device.name)
      .setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    this.speaker = accessory.getService(Service.TelevisionSpeaker)
      ?? accessory.addService(Service.TelevisionSpeaker, `${device.name} Speaker`, 'speaker');
    this.television.addLinkedService(this.speaker);

    if ((device.deviceType ?? 'television') === 'homepod') {
      this.smartSpeaker = accessory.getService(Service.SmartSpeaker)
        ?? accessory.addService(Service.SmartSpeaker, device.name, 'smart-speaker');
      this.smartSpeaker.setCharacteristic(Characteristic.ConfiguredName, device.name);
    } else {
      const staleSmartSpeaker = accessory.getService(Service.SmartSpeaker);
      if (staleSmartSpeaker) {
        accessory.removeService(staleSmartSpeaker);
      }
    }
    this.audioService = this.smartSpeaker ?? this.speaker;

    const profile = device.deviceType ?? 'television';
    const primaryService = profile === 'homepod' ? this.smartSpeaker! : profile === 'speaker' ? this.speaker : this.television;
    const televisionControlsEnabled = profile === 'speaker'
      ? this.controls.remote || this.controls.media || this.controls.inputs
      : profile === 'homepod'
        ? this.controls.power || this.controls.remote || this.controls.inputs
        : true;
    this.television.setHiddenService(!televisionControlsEnabled);
    this.speaker.setHiddenService(profile === 'homepod' || (profile !== 'speaker' && !this.controls.volume && !this.controls.mute));
    applyHomeKitPresentation(accessory, primaryService, homeKitPresentation(device, {
      TELEVISION: platform.api.hap.Categories.TELEVISION,
      TV_SET_TOP_BOX: platform.api.hap.Categories.TV_SET_TOP_BOX,
      TV_STREAMING_STICK: platform.api.hap.Categories.TV_STREAMING_STICK,
      APPLE_TV: platform.api.hap.Categories.APPLE_TV,
      AUDIO_RECEIVER: platform.api.hap.Categories.AUDIO_RECEIVER,
      SPEAKER: platform.api.hap.Categories.SPEAKER,
      HOMEPOD: platform.api.hap.Categories.HOMEPOD,
    }));

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
    this.stopped = true;
    this.inputLearner.cancel();
    this.transport?.stop();
  }

  canActAsCecWakeHelper(): boolean {
    return isCecWakeHelperRouteAvailable({
      paired: Boolean(this.transport),
      connection: this.transport?.snapshot.connection ?? 'offline',
      wakeOnLanEnabled: this.controls.wakeOnLan,
      mac: this.device.mac,
    });
  }

  async activateAsCecWakeHelper(powerToHomeDelayMs: number, timeoutMs: number): Promise<void> {
    if (!this.transport) {
      throw new Error(`${this.device.name} is not paired`);
    }
    const transport = this.transport;
    await activateCecWakeHelper({
      name: this.device.name,
      connection: () => transport.snapshot.connection,
      stopped: () => this.stopped,
      dispatchWakeOnLan: this.controls.wakeOnLan && this.device.mac
        ? () => wakeOnLan(this.device.mac!, this.device.broadcastAddress)
        : undefined,
      setPowerOn: () => transport.setPower(true),
      sendHome: () => transport.sendKey(this.controls.keyMappings.home as AndroidKeyCode),
      powerToHomeDelayMs,
      timeoutMs,
    });
  }

  wakeHelperStateChanged(helperDeviceId: string): void {
    const cecWake = resolveCecWakeConfig(this.device.cecWake);
    if (this.communicationFailure?.kind !== 'unavailable' || cecWake?.helperDeviceId !== helperDeviceId) {
      return;
    }
    if (this.hasDispatchableWakeRoute(cecWake.helperDeviceId)) {
      this.clearCommunicationFailure();
    }
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
    const configuredInputs = this.controls.inputs ? this.device.inputs ?? [] : [];
    const identifiers = assignInputIdentifiers(configuredInputs);
    const desiredSubtypes = new Set(identifiers.map(identifier => `input-${identifier}`));
    for (const service of [...this.accessory.services]) {
      if (service.UUID === Service.InputSource.UUID && (!service.subtype || !desiredSubtypes.has(service.subtype))) {
        this.accessory.removeService(service);
      }
    }
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
        .setCharacteristic(Characteristic.InputSourceType, inputSourceType(input.type))
        .setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN)
        .setCharacteristic(Characteristic.TargetVisibilityState, Characteristic.TargetVisibilityState.SHOWN);
      this.television.addLinkedService(service);
      const packageName = normalizePackageName(input.packageName);
      this.inputs.push({
        identifier,
        name: input.name,
        uri: input.uri,
        keyCode: input.keyCode,
        type: input.type,
        packageName: packageName && !duplicatePackages.includes(packageName) ? packageName : undefined,
        service,
      });
    }
    applyLearnedMappings(this.inputs, learnedMappings);
  }

  private configureCharacteristics(): void {
    const { Characteristic } = this.platform;
    this.television.getCharacteristic(Characteristic.Active)
      .onGet(() => this.activeValue())
      .onSet(async value => {
        this.requireControl('power', 'Power');
        await this.setActive(value === Characteristic.Active.ACTIVE);
      });

    const profile = this.device.deviceType ?? 'television';
    if (profile === 'speaker' && this.controls.power) {
      this.speaker.getCharacteristic(Characteristic.Active)
        .onGet(() => this.activeValue())
        .onSet(async value => this.setActive(value === Characteristic.Active.ACTIVE));
    } else if (profile !== 'homepod' && (this.controls.volume || this.controls.mute)) {
      this.speaker.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE);
    } else if (this.speaker.testCharacteristic(Characteristic.Active)) {
      this.speaker.removeCharacteristic(this.speaker.getCharacteristic(Characteristic.Active));
    }

    this.television.getCharacteristic(Characteristic.ActiveIdentifier)
      .onGet(() => this.currentIdentifier())
      .onSet(async value => {
        this.requireControl('inputs', 'Input');
        const input = this.inputs.find(item => item.identifier === Number(value));
        if (input) {
          if (inputNeedsLearning(input)) {
            this.inputLearner.begin(input.identifier, this.transport?.snapshot.currentApp);
          } else {
            this.inputLearner.cancel();
          }
          try {
            if (input.keyCode !== undefined) {
              await this.requireTransport().sendKey(input.keyCode as AndroidKeyCode);
            } else if (input.uri) {
              await this.requireTransport().launchApp(input.uri);
            } else {
              throw new Error(`${input.name} has no Android URI, package, or key code`);
            }
          } catch (error) {
            this.inputLearner.cancel();
            throw error;
          }
        }
      });

    this.television.getCharacteristic(Characteristic.RemoteKey)
      .onSet(async value => this.sendRemoteKey(Number(value)));
    this.television.getCharacteristic(Characteristic.PowerModeSelection)
      .onSet(async () => {
        this.requireControl('remote', 'Remote');
        await this.sendConfiguredKey('menu');
      });

    if (this.controls.mute || this.audioService === this.speaker) {
      this.audioService.getCharacteristic(Characteristic.Mute)
        .onGet(() => this.transport?.snapshot.muted ?? false)
        .onSet(async value => {
          this.requireControl('mute', 'Mute');
          await this.requireTransport().setMuted(Boolean(value));
        });
    } else if (this.audioService.testCharacteristic(Characteristic.Mute)) {
      this.audioService.removeCharacteristic(this.audioService.getCharacteristic(Characteristic.Mute));
    }

    if (this.controls.volume) {
      this.audioService.getCharacteristic(Characteristic.Volume)
        .onGet(() => this.transport?.snapshot.volume ?? 0)
        .onSet(async value => this.requireTransport().setVolume(Number(value)));
      if (this.audioService === this.speaker) {
        this.speaker.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);
        this.speaker.getCharacteristic(Characteristic.VolumeSelector)
          .onSet(async value => {
            await this.sendConfiguredKey(value === Characteristic.VolumeSelector.INCREMENT ? 'volumeUp' : 'volumeDown');
          });
      }
    } else {
      if (this.audioService.testCharacteristic(Characteristic.Volume)) {
        this.audioService.removeCharacteristic(this.audioService.getCharacteristic(Characteristic.Volume));
      }
      if (this.audioService !== this.speaker && this.speaker.testCharacteristic(Characteristic.Volume)) {
        this.speaker.removeCharacteristic(this.speaker.getCharacteristic(Characteristic.Volume));
      }
      for (const characteristic of [Characteristic.VolumeControlType, Characteristic.VolumeSelector]) {
        if (this.speaker.testCharacteristic(characteristic)) {
          this.speaker.removeCharacteristic(this.speaker.getCharacteristic(characteristic));
        }
      }
    }

    if (this.smartSpeaker) {
      this.smartSpeaker.getCharacteristic(Characteristic.CurrentMediaState)
        .onGet(() => this.smartMediaState);
      this.smartSpeaker.getCharacteristic(Characteristic.TargetMediaState)
        .onGet(() => this.smartMediaState)
        .onSet(async value => this.setSmartMediaState(Number(value)));
    }
  }

  private async setActive(active: boolean): Promise<void> {
    if (!this.transport) {
      throw new Error(`${this.device.name} is not paired`);
    }
    if (active && this.transport.snapshot.connection !== 'online') {
      const cecWake = resolveCecWakeConfig(this.device.cecWake);
      if (cecWake) {
        this.startCecWakeAttempt(cecWake);
        return;
      }
      if (!this.controls.wakeOnLan) {
        throw new Error(`${this.device.name} is offline and Wake-on-LAN is disabled`);
      }
      if (!this.device.mac) {
        throw new Error(`${this.device.name} is offline and has no Wake-on-LAN MAC address`);
      }
      await wakeOnLan(this.device.mac, this.device.broadcastAddress);
      return;
    }
    await this.transport.setPower(active);
  }

  private startCecWakeAttempt(cecWake: NonNullable<ReturnType<typeof resolveCecWakeConfig>>): void {
    if (this.wakeAttempt) {
      this.log.debug('[%s] CEC wake is already in progress; coalescing this request.', this.device.name);
      return;
    }
    this.clearCommunicationFailure();
    const routes = [];
    if (this.controls.wakeOnLan && this.device.mac) {
      routes.push({
        name: 'Wake-on-LAN',
        dispatch: () => wakeOnLan(this.device.mac!, this.device.broadcastAddress),
      });
    }
    if (cecWake.helperDeviceId !== this.device.id
      && this.platform.canActivateCecWakeHelper(cecWake.helperDeviceId)) {
      routes.push({
        name: `CEC helper ${cecWake.helperDeviceId}`,
        dispatch: () => this.platform.activateCecWakeHelper(
          this.device.id,
          cecWake.helperDeviceId,
          cecWake.powerToHomeDelayMs,
          cecWake.confirmationTimeoutMs,
        ),
      });
    }
    const attempt = runCecWakeAttempt({
      routes,
      confirmationTimeoutMs: cecWake.confirmationTimeoutMs,
      isTargetOnline: () => this.stopped || this.transport?.snapshot.connection === 'online',
      onRouteFailure: (route, error) => {
        this.log.warn('[%s] %s wake route failed: %s', this.device.name, route.name, String(error));
      },
    }).then(result => {
      if (this.stopped || result === 'online') {
        return;
      }
      const reason = result === 'unavailable'
        ? 'No usable Wake-on-LAN or CEC helper route is available'
        : result === 'failed'
          ? 'Every configured wake route failed'
          : `The TV did not reconnect within ${cecWake.confirmationTimeoutMs / 1_000} seconds`;
      this.log.warn('[%s] CEC wake did not confirm power on: %s.', this.device.name, reason);
      if (cecWake.failureBehavior === 'noResponse') {
        this.setCommunicationFailure(result, reason);
      }
    }).catch(error => {
      this.log.warn('[%s] CEC wake attempt failed: %s', this.device.name, String(error));
      if (!this.stopped && cecWake.failureBehavior === 'noResponse') {
        this.setCommunicationFailure('failed', 'The CEC wake attempt could not be completed');
      }
    }).finally(() => {
      if (this.wakeAttempt === attempt) {
        this.wakeAttempt = undefined;
      }
    });
    this.wakeAttempt = attempt;
  }

  private hasDispatchableWakeRoute(helperDeviceId: string): boolean {
    return (this.controls.wakeOnLan && Boolean(this.device.mac))
      || (helperDeviceId !== this.device.id && this.platform.canActivateCecWakeHelper(helperDeviceId));
  }

  private setCommunicationFailure(kind: Exclude<CecWakeAttemptResult, 'online'>, reason: string): void {
    this.communicationFailure = { kind, reason };
    const error = new Error(reason);
    this.television.getCharacteristic(this.platform.Characteristic.Active).updateValue(error);
    if ((this.device.deviceType ?? 'television') === 'speaker' && this.controls.power) {
      this.speaker.getCharacteristic(this.platform.Characteristic.Active).updateValue(error);
    }
  }

  private clearCommunicationFailure(): void {
    if (!this.communicationFailure) {
      return;
    }
    this.communicationFailure = undefined;
    const active = this.transport?.snapshot.power
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
    this.television.updateCharacteristic(this.platform.Characteristic.Active, active);
    if ((this.device.deviceType ?? 'television') === 'speaker' && this.controls.power) {
      this.speaker.updateCharacteristic(this.platform.Characteristic.Active, active);
    }
  }

  private activeValue(): CharacteristicValue {
    if (this.communicationFailure) {
      throw new Error(this.communicationFailure.reason);
    }
    return this.transport?.snapshot.power
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  }

  private async sendRemoteKey(value: number): Promise<void> {
    const { Characteristic } = this.platform;
    const mapping = new Map<number, { key: AndroidRemoteKeyName; control: 'remote' | 'media' }>([
      [Characteristic.RemoteKey.REWIND, { key: 'rewind', control: 'media' }],
      [Characteristic.RemoteKey.FAST_FORWARD, { key: 'fastForward', control: 'media' }],
      [Characteristic.RemoteKey.NEXT_TRACK, { key: 'next', control: 'media' }],
      [Characteristic.RemoteKey.PREVIOUS_TRACK, { key: 'previous', control: 'media' }],
      [Characteristic.RemoteKey.ARROW_UP, { key: 'up', control: 'remote' }],
      [Characteristic.RemoteKey.ARROW_DOWN, { key: 'down', control: 'remote' }],
      [Characteristic.RemoteKey.ARROW_LEFT, { key: 'left', control: 'remote' }],
      [Characteristic.RemoteKey.ARROW_RIGHT, { key: 'right', control: 'remote' }],
      [Characteristic.RemoteKey.SELECT, { key: 'select', control: 'remote' }],
      [Characteristic.RemoteKey.BACK, { key: 'back', control: 'remote' }],
      [Characteristic.RemoteKey.EXIT, { key: 'home', control: 'remote' }],
      [Characteristic.RemoteKey.PLAY_PAUSE, { key: 'playPause', control: 'media' }],
      [Characteristic.RemoteKey.INFORMATION, { key: 'info', control: 'remote' }],
    ]);
    const command = mapping.get(value);
    if (command) {
      this.requireControl(command.control, command.control === 'media' ? 'Media' : 'Remote');
      await this.sendConfiguredKey(command.key);
    }
  }

  private async setSmartMediaState(value: number): Promise<void> {
    const { Characteristic } = this.platform;
    this.requireControl('media', 'Media');
    const key = value === Characteristic.TargetMediaState.PLAY
      ? 'play'
      : value === Characteristic.TargetMediaState.PAUSE
        ? 'pause'
        : 'stop';
    await this.sendConfiguredKey(key);
    this.smartMediaState = value;
    this.smartSpeaker?.updateCharacteristic(Characteristic.CurrentMediaState, value);
  }

  private async sendConfiguredKey(key: AndroidRemoteKeyName): Promise<void> {
    await this.requireTransport().sendKey(this.controls.keyMappings[key] as AndroidKeyCode);
  }

  private handleState(snapshot: Readonly<DeviceSnapshot>): void {
    const { Characteristic } = this.platform;
    if (snapshot.connection === 'online') {
      this.clearCommunicationFailure();
    }
    if (!this.communicationFailure) {
      this.television.updateCharacteristic(
        Characteristic.Active,
        snapshot.power ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE,
      );
      if ((this.device.deviceType ?? 'television') === 'speaker' && this.controls.power) {
        this.speaker.updateCharacteristic(
          Characteristic.Active,
          snapshot.power ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE,
        );
      }
    }
    if (this.smartSpeaker) {
      if (!snapshot.power) {
        this.smartMediaState = Characteristic.CurrentMediaState.STOP;
      } else if (this.smartMediaState === Characteristic.CurrentMediaState.STOP) {
        this.smartMediaState = Characteristic.CurrentMediaState.PLAY;
      }
      this.smartSpeaker.updateCharacteristic(Characteristic.CurrentMediaState, this.smartMediaState);
      this.smartSpeaker.updateCharacteristic(Characteristic.TargetMediaState, this.smartMediaState);
    }
    const currentIdentifier = this.currentIdentifier(snapshot);
    this.television.updateCharacteristic(Characteristic.ActiveIdentifier, currentIdentifier);
    if (snapshot.connection !== 'online') {
      this.inputLearner.cancel();
    } else {
      this.inputLearner.observe(snapshot.currentApp, Number(currentIdentifier));
    }
    if (this.controls.mute && snapshot.muted !== undefined) {
      this.audioService.updateCharacteristic(Characteristic.Mute, snapshot.muted);
    }
    if (this.controls.volume && snapshot.volume !== undefined) {
      this.audioService.updateCharacteristic(Characteristic.Volume, snapshot.volume);
    }
    this.platform.notifyDeviceStateChanged(this.device.id);
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

  private requireControl(control: keyof Omit<ResolvedControlOptions, 'keyMappings'>, label: string): void {
    if (!this.controls[control]) {
      throw new Error(`${label} control is disabled for ${this.device.name}`);
    }
  }
}
