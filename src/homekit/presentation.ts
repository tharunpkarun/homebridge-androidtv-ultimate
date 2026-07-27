import type { PlatformAccessory, Service } from 'homebridge';
import type { AndroidTvDeviceConfig } from '../types';

export interface HomeKitCategoryCatalog {
  TELEVISION: number;
  TV_SET_TOP_BOX: number;
  TV_STREAMING_STICK: number;
  APPLE_TV: number;
  AUDIO_RECEIVER: number;
  SPEAKER: number;
  HOMEPOD: number;
}

export interface HomeKitPresentation {
  category: number;
  standalone: boolean;
}

export function homeKitPresentation(
  device: Pick<AndroidTvDeviceConfig, 'deviceType' | 'exposureMode'>,
  categories: HomeKitCategoryCatalog,
): HomeKitPresentation {
  const categoriesByProfile: Record<NonNullable<AndroidTvDeviceConfig['deviceType']>, number> = {
    television: categories.TELEVISION,
    settopbox: categories.TV_SET_TOP_BOX,
    streamingstick: categories.TV_STREAMING_STICK,
    appletv: categories.APPLE_TV,
    audioreceiver: categories.AUDIO_RECEIVER,
    speaker: categories.SPEAKER,
    homepod: categories.HOMEPOD,
  };
  return {
    category: categoriesByProfile[device.deviceType ?? 'television'],
    standalone: device.exposureMode === 'standalone',
  };
}

export function homeKitProfileLabel(deviceType?: AndroidTvDeviceConfig['deviceType']): string {
  const labels: Record<NonNullable<AndroidTvDeviceConfig['deviceType']>, string> = {
    television: 'Television',
    settopbox: 'Set-top Box',
    streamingstick: 'Streaming Stick',
    appletv: 'Apple TV',
    audioreceiver: 'Audio Receiver',
    speaker: 'Speaker',
    homepod: 'HomePod',
  };
  return labels[deviceType ?? 'television'];
}

export function applyHomeKitPresentation(
  accessory: Pick<PlatformAccessory, 'category'>,
  primaryService: Pick<Service, 'setPrimaryService'>,
  presentation: HomeKitPresentation,
): void {
  accessory.category = presentation.category as PlatformAccessory['category'];
  primaryService.setPrimaryService();
}
