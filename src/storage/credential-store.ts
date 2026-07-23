import path from 'node:path';
import type { DeviceCredentials, PersistedStatus } from '../types';
import { CREDENTIALS_FILE, STATUS_FILE, STORAGE_DIRECTORY } from '../settings';
import { readJsonFile, writePrivateJson } from './json-store';

interface CredentialDocument {
  version: 1;
  credentials: Record<string, DeviceCredentials>;
}

export class CredentialStore {
  private readonly credentialPath: string;
  private readonly statusPath: string;
  private statusWrite: Promise<void> = Promise.resolve();

  constructor(storagePath: string) {
    const directory = path.join(storagePath, STORAGE_DIRECTORY);
    this.credentialPath = path.join(directory, CREDENTIALS_FILE);
    this.statusPath = path.join(directory, STATUS_FILE);
  }

  async get(deviceId: string): Promise<DeviceCredentials | undefined> {
    const document = await this.loadAll();
    return document.credentials[deviceId];
  }

  async has(deviceId: string): Promise<boolean> {
    return Boolean(await this.get(deviceId));
  }

  async set(credentials: DeviceCredentials): Promise<void> {
    const document = await this.loadAll();
    document.credentials[credentials.deviceId] = credentials;
    await writePrivateJson(this.credentialPath, document);
  }

  async setMany(credentials: DeviceCredentials[]): Promise<void> {
    const document = await this.loadAll();
    for (const item of credentials) {
      document.credentials[item.deviceId] = item;
    }
    await writePrivateJson(this.credentialPath, document);
  }

  async remove(deviceId: string): Promise<void> {
    const document = await this.loadAll();
    delete document.credentials[deviceId];
    await writePrivateJson(this.credentialPath, document);
  }

  async list(): Promise<Array<Omit<DeviceCredentials, 'certificate' | 'privateKey'>>> {
    const document = await this.loadAll();
    return Object.values(document.credentials).map(({ certificate: _certificate, privateKey: _privateKey, ...safe }) => safe);
  }

  async writeStatus(status: PersistedStatus): Promise<void> {
    const write = this.statusWrite.catch(() => undefined).then(async () => {
      const statuses = await this.readStatuses();
      const other = statuses.filter(item => item.deviceId !== status.deviceId);
      await writePrivateJson(this.statusPath, [...other, status]);
    });
    this.statusWrite = write;
    await write;
  }

  async readStatuses(): Promise<PersistedStatus[]> {
    return readJsonFile<PersistedStatus[]>(this.statusPath, []);
  }

  private async loadAll(): Promise<CredentialDocument> {
    return readJsonFile<CredentialDocument>(this.credentialPath, { version: 1, credentials: {} });
  }
}
