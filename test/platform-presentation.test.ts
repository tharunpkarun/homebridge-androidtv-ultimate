import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Accessory, Characteristic, Service, uuid } from '@homebridge/hap-nodejs';
import type { API, Logger, PlatformAccessory } from 'homebridge';
import { AndroidTvPlatform } from '../src/platform';
import type { AndroidTvPlatformConfig } from '../src/types';

interface ApiCalls {
  registered: PlatformAccessory[];
  updated: PlatformAccessory[];
  unregistered: PlatformAccessory[];
  published: PlatformAccessory[];
}

class TestPlatformAccessory {
  readonly context: Record<string, unknown> = {};
  readonly services: Service[];
  readonly UUID: string;
  displayName: string;
  category: number;
  private readonly hapAccessory: Accessory;

  constructor(displayName: string, uuidValue: string, category = 1) {
    this.hapAccessory = new Accessory(displayName, uuidValue);
    this.hapAccessory.category = category;
    this.displayName = displayName;
    this.UUID = uuidValue;
    this.category = category;
    this.services = this.hapAccessory.services;
  }

  updateDisplayName(name: string): void {
    this.displayName = name;
    this.hapAccessory.displayName = name;
  }

  getService(service: Parameters<Accessory['getService']>[0]): Service | undefined {
    return this.hapAccessory.getService(service);
  }

  getServiceById(service: Parameters<Accessory['getServiceById']>[0], subtype: string): Service | undefined {
    return this.hapAccessory.getServiceById(service, subtype);
  }

  addService(service: Parameters<Accessory['addService']>[0], ...args: unknown[]): Service {
    return (this.hapAccessory.addService as unknown as (...values: unknown[]) => Service)(service, ...args);
  }
}

function logger(): Logger {
  const sink = () => undefined;
  return Object.assign(sink, {
    prefix: 'test',
    info: sink,
    warn: sink,
    success: sink,
    error: sink,
    debug: sink,
    log: sink,
  }) as unknown as Logger;
}

async function platformHarness(config: AndroidTvPlatformConfig): Promise<{
  platform: AndroidTvPlatform;
  api: API;
  calls: ApiCalls;
}> {
  const storage = await mkdtemp(path.join(tmpdir(), 'atvu-platform-'));
  const calls: ApiCalls = { registered: [], updated: [], unregistered: [], published: [] };
  const api = {
    hap: {
      Service,
      Characteristic,
      uuid,
      Categories: {
        TELEVISION: 31,
        TV_SET_TOP_BOX: 35,
        TV_STREAMING_STICK: 36,
        APPLE_TV: 24,
        AUDIO_RECEIVER: 34,
        SPEAKER: 26,
        HOMEPOD: 25,
      },
    },
    user: { storagePath: () => storage },
    platformAccessory: TestPlatformAccessory,
    on: () => undefined,
    registerPlatformAccessories: (_plugin: string, _platform: string, accessories: PlatformAccessory[]) => calls.registered.push(...accessories),
    updatePlatformAccessories: (accessories: PlatformAccessory[]) => calls.updated.push(...accessories),
    unregisterPlatformAccessories: (_plugin: string, _platform: string, accessories: PlatformAccessory[]) => calls.unregistered.push(...accessories),
    publishExternalAccessories: (_plugin: string, accessories: PlatformAccessory[]) => calls.published.push(...accessories),
  } as unknown as API;
  return { platform: new AndroidTvPlatform(logger(), config, api), api, calls };
}

async function synchronize(platform: AndroidTvPlatform): Promise<void> {
  await (platform as unknown as { synchronizeAccessories(): Promise<void> }).synchronizeAccessories();
}

test('bridged TVs retain their bridge identity and expose Television as primary', async () => {
  const { platform, calls } = await platformHarness({
    platform: 'AndroidTVUltimate',
    devices: [{ id: 'tv', name: 'TV', host: '192.0.2.10', deviceType: 'television' }],
  });

  await synchronize(platform);

  assert.equal(calls.registered.length, 1);
  assert.equal(calls.published.length, 0);
  assert.equal(calls.registered[0]?.category, 31);
  assert.equal(calls.registered[0]?.getService(Service.Television)?.isPrimaryService, true);
});

test('standalone mode removes a cached bridge tile before publishing the exact category', async () => {
  const { platform, api, calls } = await platformHarness({
    platform: 'AndroidTVUltimate',
    devices: [{
      id: 'box',
      name: 'Set-top Box',
      host: '192.0.2.11',
      deviceType: 'settopbox',
      exposureMode: 'standalone',
    }],
  });
  const uuidValue = api.hap.uuid.generate('androidtv-ultimate:box');
  const cached = new api.platformAccessory('Set-top Box', uuidValue);
  platform.configureAccessory(cached);

  await synchronize(platform);

  assert.deepEqual(calls.unregistered, [cached]);
  assert.equal(calls.registered.length, 0);
  assert.equal(calls.published.length, 1);
  assert.notEqual(calls.published[0], cached);
  assert.equal(calls.published[0]?.category, 35);
  assert.equal(calls.published[0]?.getService(Service.Television)?.isPrimaryService, true);
});

test('Speaker profile promotes the Speaker service and hides the Television service', async () => {
  const { platform, calls } = await platformHarness({
    platform: 'AndroidTVUltimate',
    devices: [{ id: 'speaker', name: 'Speaker', host: '192.0.2.12', deviceType: 'speaker' }],
  });

  await synchronize(platform);

  const accessory = calls.registered[0];
  assert.equal(accessory?.category, 26);
  assert.equal(accessory?.getService(Service.Speaker)?.isPrimaryService, true);
  assert.equal(accessory?.getService(Service.Television)?.isHiddenService, true);
});

test('HomePod profile promotes SmartSpeaker and uses focused control services', async () => {
  const { platform, calls } = await platformHarness({
    platform: 'AndroidTVUltimate',
    devices: [{ id: 'homepod', name: 'HomePod', host: '192.0.2.13', deviceType: 'homepod' }],
  });

  await synchronize(platform);

  const accessory = calls.registered[0];
  assert.equal(accessory?.category, 25);
  assert.equal(accessory?.getService(Service.SmartSpeaker)?.isPrimaryService, true);
  assert.equal(accessory?.getService(Service.Television)?.isHiddenService, true);
  assert.equal(accessory?.getService(Service.TelevisionSpeaker)?.isHiddenService, true);
});

test('disabled optional audio controls are removed from the visible Television accessory', async () => {
  const { platform, calls } = await platformHarness({
    platform: 'AndroidTVUltimate',
    devices: [{
      id: 'quiet-tv',
      name: 'Quiet TV',
      host: '192.0.2.14',
      controls: { volume: false, mute: false },
    }],
  });

  await synchronize(platform);

  const speaker = calls.registered[0]?.getService(Service.TelevisionSpeaker);
  assert.equal(speaker?.isHiddenService, true);
  assert.equal(speaker?.testCharacteristic(Characteristic.Volume), false);
  assert.equal(speaker?.testCharacteristic(Characteristic.VolumeSelector), false);
});

test('rich input configuration applies HomeKit source types and supports key-only commands', async () => {
  const { platform, calls } = await platformHarness({
    platform: 'AndroidTVUltimate',
    devices: [{
      id: 'input-tv',
      name: 'Input TV',
      host: '192.0.2.15',
      inputs: [{ name: 'Game Console', type: 'hdmi', keyCode: 243, identifier: 3 }],
    }],
  });

  await synchronize(platform);

  const input = calls.registered[0]?.getServiceById(Service.InputSource, 'input-3');
  assert.equal(input?.getCharacteristic(Characteristic.InputSourceType).value, Characteristic.InputSourceType.HDMI);
  assert.equal(input?.getCharacteristic(Characteristic.Identifier).value, 3);
});
