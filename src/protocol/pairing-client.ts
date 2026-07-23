import { EventEmitter } from 'node:events';
import { isIP } from 'node:net';
import tls, { type TLSSocket } from 'node:tls';
import type { DeviceCredentials } from '../types';
import { frameMessage, FrameDecoder } from './framing';
import { calculatePairingSecret, createClientCertificate, toDeviceCredentials, type ClientCertificate } from './certificates';
import {
  PairingField,
  encodePairingConfiguration,
  encodePairingOption,
  encodePairingRequest,
  encodePairingSecret,
  pairingMessageType,
} from './pairing-messages';

export type PairingState = 'idle' | 'connecting' | 'negotiating' | 'waiting-for-code' | 'verifying' | 'paired' | 'closed';

export interface PairingPrompt {
  state: 'waiting-for-code';
  deviceId: string;
  fingerprint: string;
}

export class PairingClient extends EventEmitter {
  private readonly decoder = new FrameDecoder();
  private readonly clientCertificate: ClientCertificate;
  private socket?: TLSSocket;
  private peerCertificate?: Buffer;
  private timeout?: NodeJS.Timeout;
  private stateValue: PairingState = 'idle';
  private promptResolve?: (prompt: PairingPrompt) => void;
  private promptReject?: (error: Error) => void;
  private pairedResolve?: (credentials: DeviceCredentials) => void;
  private pairedReject?: (error: Error) => void;

  constructor(
    readonly deviceId: string,
    readonly host: string,
    readonly port: number,
    readonly clientName: string,
  ) {
    super();
    this.clientCertificate = createClientCertificate(clientName);
  }

  get state(): PairingState {
    return this.stateValue;
  }

  async start(): Promise<PairingPrompt> {
    if (this.stateValue !== 'idle') {
      throw new Error('This pairing session has already started');
    }
    this.setState('connecting');
    const prompt = new Promise<PairingPrompt>((resolve, reject) => {
      this.promptResolve = resolve;
      this.promptReject = reject;
    });

    this.socket = tls.connect({
      host: this.host,
      port: this.port,
      cert: this.clientCertificate.certificate,
      key: this.clientCertificate.privateKey,
      rejectUnauthorized: false,
      ...(isIP(this.host) === 0 ? { servername: this.host } : {}),
    });
    this.timeout = setTimeout(() => this.fail(new Error('Pairing timed out after 60 seconds')), 60_000);
    this.timeout.unref();
    this.socket.once('secureConnect', () => {
      const peer = this.socket?.getPeerCertificate(true);
      if (!peer?.raw) {
        this.fail(new Error('The TV did not provide a pairing certificate'));
        return;
      }
      this.peerCertificate = peer.raw;
      this.setState('negotiating');
      this.send(encodePairingRequest('homebridge', this.clientName));
    });
    this.socket.on('data', chunk => {
      try {
        for (const message of this.decoder.push(chunk)) {
          this.handleMessage(message);
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    this.socket.once('error', error => this.fail(error));
    this.socket.once('close', () => {
      if (this.stateValue !== 'paired' && this.stateValue !== 'closed') {
        this.fail(new Error('The TV closed the pairing connection'));
      }
    });
    return prompt;
  }

  async submitCode(code: string): Promise<DeviceCredentials> {
    if (this.stateValue !== 'waiting-for-code' || !this.peerCertificate) {
      throw new Error('The TV is not waiting for a pairing code');
    }
    const paired = new Promise<DeviceCredentials>((resolve, reject) => {
      this.pairedResolve = resolve;
      this.pairedReject = reject;
    });
    const secret = calculatePairingSecret(this.clientCertificate.certificate, this.peerCertificate, code);
    this.setState('verifying');
    this.send(encodePairingSecret(secret));
    return paired;
  }

  close(): void {
    this.setState('closed');
    this.clearTimer();
    this.socket?.destroy();
  }

  private handleMessage(message: Buffer): void {
    switch (pairingMessageType(message)) {
      case PairingField.REQUEST_ACK:
        this.send(encodePairingOption());
        break;
      case PairingField.OPTION:
        this.send(encodePairingConfiguration());
        break;
      case PairingField.CONFIGURATION:
        this.setState('waiting-for-code');
        this.promptResolve?.({
          state: 'waiting-for-code',
          deviceId: this.deviceId,
          fingerprint: this.clientCertificate.fingerprint,
        });
        this.promptResolve = undefined;
        this.promptReject = undefined;
        break;
      case PairingField.SECRET_ACK: {
        const credentials = toDeviceCredentials(this.deviceId, this.clientName, this.clientCertificate);
        this.setState('paired');
        this.clearTimer();
        this.pairedResolve?.(credentials);
        this.pairedResolve = undefined;
        this.pairedReject = undefined;
        this.socket?.end();
        break;
      }
      default:
        break;
    }
  }

  private send(message: Buffer): void {
    if (!this.socket?.writable) {
      throw new Error('The pairing connection is not writable');
    }
    this.socket.write(frameMessage(message));
  }

  private setState(state: PairingState): void {
    this.stateValue = state;
    this.emit('state', state);
  }

  private fail(error: Error): void {
    this.clearTimer();
    this.promptReject?.(error);
    this.pairedReject?.(error);
    this.promptResolve = undefined;
    this.promptReject = undefined;
    this.pairedResolve = undefined;
    this.pairedReject = undefined;
    if (this.stateValue !== 'closed') {
      this.setState('closed');
    }
    this.socket?.destroy();
    this.emit('pairingError', error);
  }

  private clearTimer(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
  }
}
