import { EventEmitter } from 'node:events';
import type { DeviceSnapshot } from '../types';

export class DeviceStateMachine extends EventEmitter {
  private value: DeviceSnapshot = { connection: 'offline', power: false };
  private disconnectTimer?: NodeJS.Timeout;

  constructor(private readonly disconnectGraceMs = 2500) {
    super();
  }

  get snapshot(): Readonly<DeviceSnapshot> {
    return { ...this.value };
  }

  connecting(): void {
    this.clearDisconnectTimer();
    this.update({ connection: 'connecting', error: undefined });
  }

  connected(): void {
    this.clearDisconnectTimer();
    this.update({ connection: 'online', power: true, lastSeen: new Date().toISOString(), error: undefined });
  }

  disconnected(error?: Error): void {
    this.clearDisconnectTimer();
    this.disconnectTimer = setTimeout(() => {
      this.disconnectTimer = undefined;
      this.update({
        connection: 'offline',
        power: false,
        currentApp: undefined,
        error: error?.message,
      });
    }, this.disconnectGraceMs);
    this.disconnectTimer.unref();
  }

  reportPower(power: boolean): void {
    this.update({ power, lastSeen: new Date().toISOString() });
  }

  reportVolume(volume: number): void {
    this.update({ volume: Math.max(0, Math.min(100, volume)), lastSeen: new Date().toISOString() });
  }

  reportMute(muted: boolean): void {
    this.update({ muted, lastSeen: new Date().toISOString() });
  }

  reportApp(currentApp?: string): void {
    this.update({ currentApp, lastSeen: new Date().toISOString() });
  }

  stop(): void {
    this.clearDisconnectTimer();
    this.update({ connection: 'offline', power: false, currentApp: undefined });
  }

  private update(patch: Partial<DeviceSnapshot>): void {
    const next = { ...this.value, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.value)) {
      return;
    }
    this.value = next;
    this.emit('change', this.snapshot);
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = undefined;
    }
  }
}
