import { EventEmitter } from 'node:events';
import { isIP } from 'node:net';
import tls, { type TLSSocket } from 'node:tls';
import { REMOTE_FEATURE_MASK } from '../settings';
import type { AndroidTvDeviceConfig, DeviceCredentials, DeviceSnapshot } from '../types';
import { frameMessage, FrameDecoder } from './framing';
import {
  AndroidKeyCode,
  decodeRemoteMessage,
  encodeAppLaunch,
  encodeConfigure,
  encodeKey,
  encodePingResponse,
  encodeSetActive,
} from './remote-messages';
import { DeviceStateMachine } from './state-machine';
import type { AndroidTvTransport } from './transport';

export class RemoteServiceV2Transport extends EventEmitter implements AndroidTvTransport {
  private readonly stateMachine: DeviceStateMachine;
  private readonly decoder = new FrameDecoder();
  private socket?: TLSSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;
  private activeFeatures = REMOTE_FEATURE_MASK;
  private ready = false;
  private volumeLevel?: number;
  private volumeMax?: number;
  private stopped = true;

  constructor(
    private readonly device: AndroidTvDeviceConfig,
    private readonly credentials: DeviceCredentials,
    disconnectGraceMs = 2500,
  ) {
    super();
    this.stateMachine = new DeviceStateMachine(disconnectGraceMs);
    this.stateMachine.on('change', snapshot => this.emit('state', snapshot));
  }

  get snapshot(): Readonly<DeviceSnapshot> {
    return this.stateMachine.snapshot;
  }

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ready = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.destroy();
    this.socket = undefined;
    this.decoder.reset();
    this.stateMachine.stop();
    this.emit('stopped');
  }

  updateEndpoint(host: string, port: number): void {
    if (this.device.host === host && (this.device.remotePort ?? 6466) === port) {
      return;
    }
    this.device.host = host;
    this.device.remotePort = port;
    if (this.stopped) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.socket) {
      this.socket.destroy();
    } else {
      this.connect();
    }
  }

  async sendKey(key: AndroidKeyCode): Promise<void> {
    await this.waitUntilReady();
    this.write(encodeKey(key));
  }

  async launchApp(uri: string): Promise<void> {
    await this.waitUntilReady();
    this.write(encodeAppLaunch(uri));
  }

  async setPower(active: boolean): Promise<void> {
    await this.waitUntilReady();
    if (this.snapshot.power === active) {
      return;
    }
    this.write(encodeKey(AndroidKeyCode.POWER));
    this.stateMachine.reportPower(active);
  }

  async setVolume(level: number): Promise<void> {
    await this.waitUntilReady();
    const normalized = Math.max(0, Math.min(100, Math.round(level)));
    if (this.volumeLevel === undefined || this.volumeMax === undefined || this.volumeMax <= 0) {
      throw new Error('Android TV has not reported a usable volume range');
    }
    const target = Math.round((normalized / 100) * this.volumeMax);
    const difference = target - this.volumeLevel;
    const key = difference >= 0 ? AndroidKeyCode.VOLUME_UP : AndroidKeyCode.VOLUME_DOWN;
    for (let index = 0; index < Math.abs(difference); index += 1) {
      this.write(encodeKey(key));
    }
    this.volumeLevel = target;
    this.stateMachine.reportVolume(normalized);
  }

  async setMuted(muted: boolean): Promise<void> {
    await this.waitUntilReady();
    if (this.snapshot.muted === muted) {
      return;
    }
    this.write(encodeKey(AndroidKeyCode.MUTE));
    this.stateMachine.reportMute(muted);
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }
    this.ready = false;
    this.activeFeatures = REMOTE_FEATURE_MASK;
    this.volumeLevel = undefined;
    this.volumeMax = undefined;
    this.stateMachine.connecting();
    const socket = tls.connect({
      host: this.device.host,
      port: this.device.remotePort ?? 6466,
      cert: this.credentials.certificate,
      key: this.credentials.privateKey,
      rejectUnauthorized: false,
      ...(isIP(this.device.host) === 0 ? { servername: this.device.host } : {}),
    });
    this.socket = socket;
    socket.setKeepAlive(true, 10_000);
    socket.once('secureConnect', () => {
      this.reconnectAttempt = 0;
    });
    socket.on('data', chunk => {
      try {
        for (const message of this.decoder.push(chunk)) {
          this.handleMessage(message);
        }
      } catch (error) {
        socket.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on('error', error => this.emit('error', error));
    socket.once('close', () => {
      this.ready = false;
      if (this.socket === socket) {
        this.socket = undefined;
      }
      this.decoder.reset();
      this.stateMachine.disconnected();
      this.scheduleReconnect();
    });
  }

  private handleMessage(message: Buffer): void {
    const event = decodeRemoteMessage(message);
    switch (event.type) {
      case 'configure':
        if (event.features !== undefined && event.features > 0) {
          this.activeFeatures = REMOTE_FEATURE_MASK & event.features;
        }
        this.write(encodeConfigure(this.activeFeatures));
        break;
      case 'setActive':
        this.write(encodeSetActive(this.activeFeatures));
        break;
      case 'start':
        this.ready = true;
        this.stateMachine.connected(event.started !== false);
        this.emit('ready');
        break;
      case 'ping':
        if (event.ping) {
          this.write(encodePingResponse(event.ping.value1));
        }
        break;
      case 'volume':
        if (event.volume !== undefined) {
          this.volumeLevel = event.volume;
          this.volumeMax = event.volumeMax && event.volumeMax > 0 ? event.volumeMax : undefined;
          const normalized = this.volumeMax
            ? Math.round((this.volumeLevel / this.volumeMax) * 100)
            : this.volumeLevel;
          this.stateMachine.reportVolume(normalized);
        }
        if (event.muted !== undefined) {
          this.stateMachine.reportMute(event.muted);
        }
        break;
      case 'app':
        this.stateMachine.reportApp(event.currentApp);
        break;
      case 'error':
        this.emit('error', new Error(`Android TV remote error ${event.errorCode ?? 'unknown'}`));
        break;
      default:
        break;
    }
  }

  private write(message: Buffer): void {
    if (!this.socket?.writable) {
      throw new Error('Android TV remote connection is offline');
    }
    this.socket.write(frameMessage(message));
  }

  private async waitUntilReady(timeoutMs = 10_000): Promise<void> {
    if (this.ready && this.socket?.writable) {
      return;
    }
    if (this.stopped) {
      throw new Error('Android TV remote connection is stopped');
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        this.off('ready', onReady);
        this.off('stopped', onStopped);
      };
      const onReady = (): void => {
        cleanup();
        resolve();
      };
      const onStopped = (): void => {
        cleanup();
        reject(new Error('Android TV remote connection was stopped'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Android TV remote connection did not become ready'));
      }, timeoutMs);
      timer.unref();
      this.once('ready', onReady);
      this.once('stopped', onStopped);
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    const base = Math.min(30_000, 1_000 * (2 ** Math.min(this.reconnectAttempt, 5)));
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }
}
