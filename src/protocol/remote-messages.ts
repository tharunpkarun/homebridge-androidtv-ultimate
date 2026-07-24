import { CLIENT_MODEL, CLIENT_PACKAGE, CLIENT_VENDOR, PROTOCOL_VERSION } from '../settings';
import { ProtoWriter, decodeFields, firstBytes, firstNumber } from './protobuf';

export enum AndroidKeyCode {
  HOME = 3,
  BACK = 4,
  DPAD_UP = 19,
  DPAD_DOWN = 20,
  DPAD_LEFT = 21,
  DPAD_RIGHT = 22,
  DPAD_CENTER = 23,
  VOLUME_UP = 24,
  VOLUME_DOWN = 25,
  POWER = 26,
  MENU = 82,
  MEDIA_PLAY_PAUSE = 85,
  MUTE = 164,
  INFO = 165,
  SLEEP = 223,
  WAKEUP = 224,
}

export const RemoteField = {
  CONFIGURE: 1,
  SET_ACTIVE: 2,
  ERROR: 3,
  START: 5,
  PING_REQUEST: 8,
  PING_RESPONSE: 9,
  KEY_INJECT: 10,
  IME_KEY_INJECT: 20,
  SET_VOLUME_LEVEL: 19,
  SET_MUTE: 21,
  APP_LINK_LAUNCH_REQUEST: 90,
} as const;

export interface RemoteEvent {
  type: 'configure' | 'start' | 'ping' | 'volume' | 'mute' | 'app' | 'error' | 'unknown';
  started?: boolean;
  volume?: number;
  muted?: boolean;
  currentApp?: string;
  errorCode?: number;
  rawField?: number;
  ping?: { value1: number; value2: number };
}

export function encodeConfigure(clientName: string): Buffer {
  return new ProtoWriter().message(RemoteField.CONFIGURE, configure => {
    configure.varint(1, PROTOCOL_VERSION).message(2, info => {
      info.string(1, CLIENT_MODEL)
        .string(2, CLIENT_VENDOR)
        .string(3, '1')
        .string(4, clientName)
        .string(5, CLIENT_PACKAGE)
        .string(6, '0.1.0');
    });
  }).finish();
}

export function encodeSetActive(): Buffer {
  return new ProtoWriter().message(RemoteField.SET_ACTIVE, writer => writer.varint(1, PROTOCOL_VERSION)).finish();
}

export function encodePingResponse(value1: number, value2: number): Buffer {
  return new ProtoWriter().message(RemoteField.PING_RESPONSE, writer => writer.varint(1, value1).varint(2, value2)).finish();
}

export function encodeKey(keyCode: AndroidKeyCode, direction = 3): Buffer {
  return new ProtoWriter().message(RemoteField.KEY_INJECT, writer => {
    writer.varint(1, keyCode).varint(2, direction);
  }).finish();
}

export function encodeAppLaunch(uri: string): Buffer {
  return new ProtoWriter().message(RemoteField.APP_LINK_LAUNCH_REQUEST, writer => writer.string(1, uri)).finish();
}

export function encodeVolume(level: number): Buffer {
  return new ProtoWriter().message(RemoteField.SET_VOLUME_LEVEL, writer => writer.varint(1, Math.round(level))).finish();
}

export function encodeMute(muted: boolean): Buffer {
  return new ProtoWriter().message(RemoteField.SET_MUTE, writer => writer.bool(1, muted)).finish();
}

export function decodeRemoteMessage(message: Buffer): RemoteEvent {
  const outer = decodeFields(message);
  const top = outer.find(field => Buffer.isBuffer(field.value));
  if (!top || !Buffer.isBuffer(top.value)) {
    return { type: 'unknown' };
  }
  const nested = decodeFields(top.value);
  switch (top.number) {
    case RemoteField.CONFIGURE:
      return { type: 'configure' };
    case RemoteField.START:
      return { type: 'start', started: firstNumber(nested, 1) !== 0 };
    case RemoteField.PING_REQUEST:
      return {
        type: 'ping',
        ping: { value1: firstNumber(nested, 1) ?? 0, value2: firstNumber(nested, 2) ?? 0 },
      };
    case RemoteField.IME_KEY_INJECT: {
      const appInfo = firstBytes(nested, 1);
      if (appInfo) {
        const appPackage = firstBytes(decodeFields(appInfo), 12)?.toString('utf8').trim();
        return { type: 'app', currentApp: appPackage || undefined };
      }
      // Some firmware uses field 20 for a scalar volume adjustment instead of IME status.
      return { type: 'volume', volume: firstNumber(nested, 1) };
    }
    case RemoteField.SET_VOLUME_LEVEL:
      return { type: 'volume', volume: firstNumber(nested, 1) };
    case RemoteField.SET_MUTE:
      return { type: 'mute', muted: firstNumber(nested, 1) !== 0 };
    case RemoteField.ERROR:
      return { type: 'error', errorCode: firstNumber(nested, 1) };
    default:
      return { type: 'unknown', rawField: top.number };
  }
}

export function nestedPayload(message: Buffer, field: number): Buffer | undefined {
  return firstBytes(decodeFields(message), field);
}
