import type { DeviceSnapshot } from '../types';
import type { AndroidKeyCode } from './remote-messages';

export interface AndroidTvTransport {
  readonly snapshot: Readonly<DeviceSnapshot>;
  start(): void;
  stop(): void;
  updateEndpoint(host: string, port: number): void;
  sendKey(key: AndroidKeyCode): Promise<void>;
  launchApp(uri: string): Promise<void>;
  setPower(active: boolean): Promise<void>;
  setVolume(level: number): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  on(event: 'state', listener: (snapshot: Readonly<DeviceSnapshot>) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}
