import path from 'node:path';
import { INPUT_MAPPINGS_FILE, STORAGE_DIRECTORY } from '../settings';
import type { LearnedInputMapping } from '../types';
import { readJsonFile, writePrivateJson } from './json-store';

interface InputMappingDocument {
  version: 1;
  mappings: LearnedInputMapping[];
}

export class InputMappingStore {
  private readonly file: string;
  private mutation: Promise<void> = Promise.resolve();

  constructor(storagePath: string) {
    this.file = path.join(storagePath, STORAGE_DIRECTORY, INPUT_MAPPINGS_FILE);
  }

  async list(deviceId?: string): Promise<LearnedInputMapping[]> {
    const document = await this.load();
    return document.mappings
      .filter(mapping => !deviceId || mapping.deviceId === deviceId)
      .map(mapping => ({ ...mapping }));
  }

  async learn(deviceId: string, inputIdentifier: number, packageName: string): Promise<LearnedInputMapping[]> {
    await this.enqueue(async document => {
      document.mappings = document.mappings.filter(mapping => mapping.deviceId !== deviceId
        || (mapping.inputIdentifier !== inputIdentifier && mapping.packageName !== packageName));
      document.mappings.push({
        deviceId,
        inputIdentifier,
        packageName,
        learnedAt: new Date().toISOString(),
      });
    });
    return this.list(deviceId);
  }

  async remove(deviceId: string, inputIdentifier: number): Promise<void> {
    await this.enqueue(async document => {
      document.mappings = document.mappings.filter(mapping => mapping.deviceId !== deviceId
        || mapping.inputIdentifier !== inputIdentifier);
    });
  }

  async replaceAll(mappings: LearnedInputMapping[]): Promise<void> {
    await this.enqueue(async document => {
      document.mappings = mappings.map(mapping => ({ ...mapping }));
    });
  }

  private async load(): Promise<InputMappingDocument> {
    return readJsonFile<InputMappingDocument>(this.file, { version: 1, mappings: [] });
  }

  private async enqueue(update: (document: InputMappingDocument) => Promise<void>): Promise<void> {
    const mutation = this.mutation.catch(() => undefined).then(async () => {
      const document = await this.load();
      await update(document);
      await writePrivateJson(this.file, document);
    });
    this.mutation = mutation;
    await mutation;
  }
}
