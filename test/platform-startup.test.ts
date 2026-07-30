import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Characteristic, Service } from '@homebridge/hap-nodejs';
import type { API, Logger } from 'homebridge';
import { AndroidTvPlatform } from '../src/platform';

interface DiscoveryCacheStub {
  load(): Promise<void>;
}

function recordingLogger(errors: unknown[][]): Logger {
  const sink = () => undefined;
  return Object.assign(sink, {
    prefix: 'test',
    info: sink,
    warn: sink,
    success: sink,
    error: (...args: unknown[]) => errors.push(args),
    debug: sink,
    log: sink,
  }) as unknown as Logger;
}

test('platform startup failures are caught and logged', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'atvu-startup-'));
  try {
    const lifecycle = new Map<string, () => void>();
    const errors: unknown[][] = [];
    const api = {
      hap: { Service, Characteristic },
      user: { storagePath: () => storage },
      on: (event: string, callback: () => void) => lifecycle.set(event, callback),
    } as unknown as API;
    const platform = new AndroidTvPlatform(
      recordingLogger(errors),
      { platform: 'AndroidTVUltimate' },
      api,
    );
    const discoveryCache = (platform as unknown as { discoveryCache: DiscoveryCacheStub }).discoveryCache;
    discoveryCache.load = async () => {
      throw new Error('storage unavailable');
    };

    lifecycle.get('didFinishLaunching')?.();
    await new Promise<void>(resolve => setImmediate(resolve));

    assert.deepEqual(errors, [['Platform startup failed: %s', 'Error: storage unavailable']]);
  } finally {
    await rm(storage, { recursive: true, force: true });
  }
});
