import { EventEmitter } from 'node:events';
import { isIP } from 'node:net';
import tls, { type TLSSocket } from 'node:tls';
import type { AndroidTvDeviceConfig, DeviceCredentials, DeviceSnapshot } from '../types';
import { frameMessage, FrameDecoder } from './framing';
import {
  AndroidKeyCode,
  decodeRemoteMessage,
  encodeAppLaunch,
  encodeConfigure,
  encodeKey,
  encodeMute,
  encodePingResponse,
  encodeSetActive,
  encodeVolume,
} from './remote-messages';
import { DeviceStateMachine } from './state-machine';
import type { AndroidTvTransport } from './transport';

export class RemoteServiceV2Transport extends EventEmitter implements AndroidTvTransport {
  private readonly stateMachine: DeviceStateMachine;
  private readonly decoder = new FrameDecoder();
  private socket?: TLSSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.destroy();
    this.socket = undefined;
    this.decoder.reset();
    this.stateMachine.stop();
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
    this.write(encodeKey(key));
  }

  async launchApp(uri: string): Promise<void> {
    this.write(encodeAppLaunch(uri));
    this.stateMachine.reportApp(uri);
  }

  async setPower(active: boolean): Promise<void> {
    if (!this.socket?.writable) {
      if (active) {
        throw new Error('TV is offline; Wake-on-LAN is required to turn it on');
      }
      this.stateMachine.reportPower(false);
      return;
    }
    this.write(encodeKey(active ? AndroidKeyCode.WAKEUP : AndroidKeyCode.SLEEP));
    this.stateMachine.reportPower(active);
  }

  async setVolume(level: number): Promise<void> {
    const normalized = Math.max(0, Math.min(100, Math.round(level)));
    this.write(encodeVolume(normalized));
    this.stateMachine.reportVolume(normalized);
  }

  async setMuted(muted: boolean): Promise<void> {
    this.write(encodeMute(muted));
    this.stateMachine.reportMute(muted);
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }
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
      this.stateMachine.connected();
      this.write(encodeConfigure(this.credentials.clientName));
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
        this.write(encodeSetActive());
        break;
      case 'start':
        this.stateMachine.reportPower(event.started !== false);
        break;
      case 'ping':
        if (event.ping) {
          this.write(encodePingResponse(event.ping.value1, event.ping.value2));
        }
        break;
      case 'volume':
        if (event.volume !== undefined) {
          this.stateMachine.reportVolume(event.volume);
        }
        break;
      case 'mute':
        if (event.muted !== undefined) {
          this.stateMachine.reportMute(event.muted);
        }
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
