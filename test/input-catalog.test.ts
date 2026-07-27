import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  InputCatalogService,
  validateInputCatalog,
  type InputCatalogDocument,
} from '../src/input/input-catalog';
import { INPUT_CATALOG_CACHE_FILE, STORAGE_DIRECTORY } from '../src/settings';

const bundledPath = path.join(process.cwd(), 'catalog', 'input-presets.json');

async function bundledCatalog(): Promise<InputCatalogDocument> {
  return validateInputCatalog(JSON.parse(await readFile(bundledPath, 'utf8')) as unknown);
}

function response(
  status: number,
  body = '',
  headers: Record<string, string> = {},
) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => normalized.get(name.toLowerCase()) ?? null },
    text: async () => body,
  };
}

test('bundled input catalog is valid and contains app and hardware presets', async () => {
  const catalog = await bundledCatalog();
  assert.equal(catalog.schemaVersion, 1);
  assert.ok(catalog.presets.some(preset => preset.uri === 'com.google.android.youtube.tv'));
  assert.ok(catalog.presets.some(preset => preset.type === 'hdmi' && preset.keyCode === 243));
  assert.ok(catalog.presets.some(preset => preset.type === 'usb'));
});

test('catalog validation rejects duplicate, unsupported, commandless, and oversized entries', async () => {
  const catalog = await bundledCatalog();
  assert.throws(() => validateInputCatalog({ ...catalog, schemaVersion: 2 }), /Unsupported input catalog schema/);
  assert.throws(() => validateInputCatalog({ ...catalog, unexpected: true }), /unsupported field unexpected/);
  assert.throws(() => validateInputCatalog({
    ...catalog,
    presets: [...catalog.presets, { ...catalog.presets[0] }],
  }), /duplicate preset id/);
  assert.throws(() => validateInputCatalog({
    ...catalog,
    presets: [{ id: 'bad-type', group: 'Test', name: 'Bad', type: 'unknown', uri: 'com.example.bad' }],
  }), /unsupported input type/);
  assert.throws(() => validateInputCatalog({
    ...catalog,
    presets: [{ id: 'no-command', group: 'Test', name: 'Bad', type: 'application' }],
  }), /exactly one command/);
  assert.throws(() => validateInputCatalog({
    ...catalog,
    presets: [{ id: 'too-large', group: 'Test', name: 'Bad', type: 'application', uri: `app://${'x'.repeat(1024 * 1024)}` }],
  }), /exceeds/);
});

test('remote catalog refresh saves and conditionally revalidates the last known good cache', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'atvu-catalog-cache-'));
  const catalog = await bundledCatalog();
  const requests: Record<string, string>[] = [];
  let call = 0;
  const service = new InputCatalogService(storage, {
    bundledPath,
    fetcher: async (_url, init) => {
      requests.push(init.headers);
      call += 1;
      return call === 1
        ? response(200, JSON.stringify(catalog), { etag: '"catalog-v1"' })
        : response(304);
    },
  });

  const fresh = await service.refresh();
  assert.equal(fresh.source, 'remote');
  assert.equal(fresh.presets.length, catalog.presets.length);
  const revalidated = await service.refresh();
  assert.equal(revalidated.source, 'cache');
  assert.equal(requests[1]?.['if-none-match'], '"catalog-v1"');

  const offline = new InputCatalogService(storage, { bundledPath, fetcher: async () => response(500) });
  const local = await offline.local();
  assert.equal(local.source, 'cache');
  assert.equal(local.presets.length, catalog.presets.length);
});

test('failed or invalid refreshes retain the previous valid catalog', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'atvu-catalog-invalid-'));
  const catalog = await bundledCatalog();
  const changed = {
    ...catalog,
    updatedAt: '2026-07-29',
    presets: catalog.presets.map(preset => preset.id === 'youtube' ? { ...preset, name: 'YouTube TV' } : preset),
  };
  let body = JSON.stringify(changed);
  const service = new InputCatalogService(storage, {
    bundledPath,
    fetcher: async () => response(200, body),
  });
  assert.equal((await service.refresh()).presets.find(item => item.id === 'youtube')?.name, 'YouTube TV');

  body = '{not json';
  const invalid = await service.refresh();
  assert.equal(invalid.source, 'cache');
  assert.match(invalid.warning ?? '', /not valid JSON/);
  assert.equal(invalid.presets.find(item => item.id === 'youtube')?.name, 'YouTube TV');
  assert.equal((await service.local()).presets.find(item => item.id === 'youtube')?.name, 'YouTube TV');
});

test('offline first use and corrupt cache safely fall back to the bundled catalog', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'atvu-catalog-fallback-'));
  const cacheFile = path.join(storage, STORAGE_DIRECTORY, INPUT_CATALOG_CACHE_FILE);
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, '{corrupt cache', 'utf8');
  const service = new InputCatalogService(storage, {
    bundledPath,
    fetcher: async () => response(503),
  });
  const local = await service.local();
  assert.equal(local.source, 'bundled');
  const refreshed = await service.refresh();
  assert.equal(refreshed.source, 'bundled');
  assert.match(refreshed.warning ?? '', /HTTP 503/);
  assert.ok(refreshed.presets.length > 0);
});

test('catalog timeout and oversized responses use the bundled fallback', async () => {
  const timeoutStorage = await mkdtemp(path.join(tmpdir(), 'atvu-catalog-timeout-'));
  const timeoutService = new InputCatalogService(timeoutStorage, {
    bundledPath,
    timeoutMs: 5,
    fetcher: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });
  const timedOut = await timeoutService.refresh();
  assert.equal(timedOut.source, 'bundled');
  assert.match(timedOut.warning ?? '', /timed out/);

  const sizeStorage = await mkdtemp(path.join(tmpdir(), 'atvu-catalog-size-'));
  const sizeService = new InputCatalogService(sizeStorage, {
    bundledPath,
    fetcher: async () => response(200, '{}', { 'content-length': String(2 * 1024 * 1024) }),
  });
  const oversized = await sizeService.refresh();
  assert.equal(oversized.source, 'bundled');
  assert.match(oversized.warning ?? '', /exceeds/);
});

test('concurrent refresh requests share one GitHub request', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'atvu-catalog-dedupe-'));
  const catalog = await bundledCatalog();
  let calls = 0;
  const service = new InputCatalogService(storage, {
    bundledPath,
    fetcher: async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return response(200, JSON.stringify(catalog));
    },
  });
  const [first, second] = await Promise.all([service.refresh(), service.refresh()]);
  assert.equal(calls, 1);
  assert.deepEqual(first.presets, second.presets);
});
