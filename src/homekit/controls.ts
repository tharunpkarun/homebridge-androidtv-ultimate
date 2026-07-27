import { AndroidKeyCode } from '../protocol/remote-messages';
import type {
  AndroidRemoteKeyName,
  AndroidTvControlConfig,
  AndroidTvDeviceConfig,
  AndroidTvDeviceType,
  AppInputType,
} from '../types';

export interface ResolvedControlOptions {
  power: boolean;
  remote: boolean;
  media: boolean;
  volume: boolean;
  mute: boolean;
  inputs: boolean;
  wakeOnLan: boolean;
  keyMappings: Record<AndroidRemoteKeyName, number>;
}

export const DEFAULT_KEY_MAPPINGS: Record<AndroidRemoteKeyName, number> = {
  up: AndroidKeyCode.DPAD_UP,
  down: AndroidKeyCode.DPAD_DOWN,
  left: AndroidKeyCode.DPAD_LEFT,
  right: AndroidKeyCode.DPAD_RIGHT,
  select: AndroidKeyCode.DPAD_CENTER,
  back: AndroidKeyCode.BACK,
  home: AndroidKeyCode.HOME,
  menu: AndroidKeyCode.MENU,
  info: AndroidKeyCode.INFO,
  volumeUp: AndroidKeyCode.VOLUME_UP,
  volumeDown: AndroidKeyCode.VOLUME_DOWN,
  playPause: AndroidKeyCode.MEDIA_PLAY_PAUSE,
  play: AndroidKeyCode.MEDIA_PLAY,
  pause: AndroidKeyCode.MEDIA_PAUSE,
  stop: AndroidKeyCode.MEDIA_STOP,
  next: AndroidKeyCode.MEDIA_NEXT,
  previous: AndroidKeyCode.MEDIA_PREVIOUS,
  rewind: AndroidKeyCode.MEDIA_REWIND,
  fastForward: AndroidKeyCode.MEDIA_FAST_FORWARD,
};

const FULL_CONTROL_DEFAULTS: Omit<ResolvedControlOptions, 'keyMappings'> = {
  power: true,
  remote: true,
  media: true,
  volume: true,
  mute: true,
  inputs: true,
  wakeOnLan: true,
};

export function controlDefaults(deviceType: AndroidTvDeviceType = 'television'): Omit<ResolvedControlOptions, 'keyMappings'> {
  switch (deviceType) {
    case 'speaker':
      return { ...FULL_CONTROL_DEFAULTS, remote: false, media: false, inputs: false };
    case 'homepod':
      return { ...FULL_CONTROL_DEFAULTS, power: false, remote: false, inputs: false, wakeOnLan: false };
    default:
      return { ...FULL_CONTROL_DEFAULTS };
  }
}

export function resolveControlOptions(
  device: Pick<AndroidTvDeviceConfig, 'deviceType' | 'controls'>,
): ResolvedControlOptions {
  const defaults = controlDefaults(device.deviceType);
  const configured: AndroidTvControlConfig = device.controls ?? {};
  const keyMappings = { ...DEFAULT_KEY_MAPPINGS };
  for (const key of Object.keys(DEFAULT_KEY_MAPPINGS) as AndroidRemoteKeyName[]) {
    const value = configured.keyMappings?.[key];
    if (Number.isInteger(value) && value !== undefined && value >= 0 && value <= 1000) {
      keyMappings[key] = value;
    }
  }
  return {
    power: configured.power ?? defaults.power,
    remote: configured.remote ?? defaults.remote,
    media: configured.media ?? defaults.media,
    volume: configured.volume ?? defaults.volume,
    mute: configured.mute ?? defaults.mute,
    inputs: configured.inputs ?? defaults.inputs,
    wakeOnLan: configured.wakeOnLan ?? defaults.wakeOnLan,
    keyMappings,
  };
}

export function inputSourceType(type: AppInputType = 'application'): number {
  return {
    other: 0,
    home: 1,
    tuner: 2,
    hdmi: 3,
    composite: 4,
    svideo: 5,
    component: 6,
    dvi: 7,
    airplay: 8,
    usb: 9,
    application: 10,
  }[type];
}
