import type { PlatformAccessory, Service } from 'homebridge';
import type { AndroidTvDeviceConfig } from '../types';

export interface HomeKitCategoryCatalog {
  TELEVISION: number;
  TV_SET_TOP_BOX: number;
}

export interface HomeKitPresentation {
  category: number;
  standalone: boolean;
}

export function homeKitPresentation(
  device: Pick<AndroidTvDeviceConfig, 'deviceType' | 'exposureMode'>,
  categories: HomeKitCategoryCatalog,
): HomeKitPresentation {
  return {
    category: device.deviceType === 'settopbox' ? categories.TV_SET_TOP_BOX : categories.TELEVISION,
    standalone: device.exposureMode === 'standalone',
  };
}

export function applyHomeKitPresentation(
  accessory: Pick<PlatformAccessory, 'category'>,
  television: Pick<Service, 'setPrimaryService'>,
  presentation: HomeKitPresentation,
): void {
  accessory.category = presentation.category as PlatformAccessory['category'];
  television.setPrimaryService();
}
