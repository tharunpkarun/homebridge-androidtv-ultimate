import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { INPUT_CATALOG_CACHE_FILE, INPUT_CATALOG_URL, STORAGE_DIRECTORY } from '../settings';
import type { AppInputType } from '../types';
import { readJsonFile, writePrivateJson } from '../storage/json-store';

export const INPUT_CATALOG_SCHEMA_VERSION = 1 as const;
export const INPUT_CATALOG_MAX_BYTES = 1024 * 1024;
export const INPUT_CATALOG_MAX_PRESETS = 2000;

const SUPPORTED_INPUT_TYPES = new Set<AppInputType>([
  'other', 'home', 'tuner', 'hdmi', 'composite', 'svideo',
  'component', 'dvi', 'airplay', 'usb', 'application',
]);

export interface InputCatalogPreset {
  id: string;
  group: string;
  name: string;
  type: AppInputType;
  uri?: string;
  packageName?: string;
  keyCode?: number;
}

export interface InputCatalogDocument {
  schemaVersion: typeof INPUT_CATALOG_SCHEMA_VERSION;
  updatedAt: string;
  presets: InputCatalogPreset[];
}

export interface InputCatalogResult extends InputCatalogDocument {
  source: 'remote' | 'cache' | 'bundled';
  fetchedAt?: string;
  checkedAt?: string;
  warning?: string;
}

interface InputCatalogCacheDocument {
  version: 1;
  catalog: InputCatalogDocument;
  etag?: string;
  fetchedAt: string;
  checkedAt: string;
}

interface CatalogFetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

type CatalogFetch = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<CatalogFetchResponse>;

export interface InputCatalogServiceOptions {
  fetcher?: CatalogFetch;
  bundledPath?: string;
  remoteUrl?: string;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(value).find(key => !allowed.has(key));
  if (unknown) {
    throw new Error(`${label} contains unsupported field ${unknown}`);
  }
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must be a trimmed string from 1 to ${maximum} characters`);
  }
  if (/\p{C}/u.test(value)) {
    throw new Error(`${label} contains control characters`);
  }
  return value;
}

function optionalText(value: unknown, label: string, maximum: number): string | undefined {
  return value === undefined ? undefined : requiredText(value, label, maximum);
}

function parsePreset(value: unknown, index: number): InputCatalogPreset {
  const label = `Preset ${index + 1}`;
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  assertOnlyKeys(value, new Set(['id', 'group', 'name', 'type', 'uri', 'packageName', 'keyCode']), label);
  const id = requiredText(value.id, `${label} id`, 64);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`${label} id must use lowercase letters, numbers, and single hyphens`);
  }
  const group = requiredText(value.group, `${label} group`, 80);
  const name = requiredText(value.name, `${label} name`, 100);
  if (typeof value.type !== 'string' || !SUPPORTED_INPUT_TYPES.has(value.type as AppInputType)) {
    throw new Error(`${label} has an unsupported input type`);
  }
  const uri = optionalText(value.uri, `${label} uri`, 500);
  const packageName = optionalText(value.packageName, `${label} packageName`, 255);
  const keyCode = value.keyCode;
  if (keyCode !== undefined && (!Number.isInteger(keyCode) || Number(keyCode) < 0 || Number(keyCode) > 1000)) {
    throw new Error(`${label} keyCode must be an integer from 0 to 1000`);
  }
  if (Boolean(uri) === (keyCode !== undefined)) {
    throw new Error(`${label} must define exactly one command: uri or keyCode`);
  }
  return {
    id,
    group,
    name,
    type: value.type as AppInputType,
    ...(uri ? { uri } : {}),
    ...(packageName ? { packageName } : {}),
    ...(keyCode !== undefined ? { keyCode: Number(keyCode) } : {}),
  };
}

export function validateInputCatalog(value: unknown): InputCatalogDocument {
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    throw new Error('Input catalog must be JSON-serializable');
  }
  if (size > INPUT_CATALOG_MAX_BYTES) {
    throw new Error(`Input catalog exceeds ${INPUT_CATALOG_MAX_BYTES} bytes`);
  }
  if (!isRecord(value)) {
    throw new Error('Input catalog must be an object');
  }
  assertOnlyKeys(value, new Set(['schemaVersion', 'updatedAt', 'presets']), 'Input catalog');
  if (value.schemaVersion !== INPUT_CATALOG_SCHEMA_VERSION) {
    throw new Error(`Unsupported input catalog schema version ${String(value.schemaVersion)}`);
  }
  const updatedAt = requiredText(value.updatedAt, 'Input catalog updatedAt', 40);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(updatedAt) || Number.isNaN(Date.parse(updatedAt))) {
    throw new Error('Input catalog updatedAt must be an ISO date or timestamp');
  }
  if (!Array.isArray(value.presets) || value.presets.length === 0 || value.presets.length > INPUT_CATALOG_MAX_PRESETS) {
    throw new Error(`Input catalog must contain 1 to ${INPUT_CATALOG_MAX_PRESETS} presets`);
  }
  const presets = value.presets.map(parsePreset);
  const ids = new Set<string>();
  for (const preset of presets) {
    if (ids.has(preset.id)) {
      throw new Error(`Input catalog contains duplicate preset id ${preset.id}`);
    }
    ids.add(preset.id);
  }
  return { schemaVersion: INPUT_CATALOG_SCHEMA_VERSION, updatedAt, presets };
}

function parseCatalog(source: string): InputCatalogDocument {
  if (Buffer.byteLength(source, 'utf8') > INPUT_CATALOG_MAX_BYTES) {
    throw new Error(`Input catalog exceeds ${INPUT_CATALOG_MAX_BYTES} bytes`);
  }
  try {
    return validateInputCatalog(JSON.parse(source) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Input catalog is not valid JSON');
    }
    throw error;
  }
}

function cloneResult(
  catalog: InputCatalogDocument,
  source: InputCatalogResult['source'],
  metadata: Pick<InputCatalogResult, 'fetchedAt' | 'checkedAt' | 'warning'> = {},
): InputCatalogResult {
  return {
    schemaVersion: catalog.schemaVersion,
    updatedAt: catalog.updatedAt,
    presets: catalog.presets.map(preset => ({ ...preset })),
    source,
    ...metadata,
  };
}

export class InputCatalogService {
  private readonly cacheFile: string;
  private readonly bundledPath?: string;
  private readonly remoteUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: CatalogFetch;
  private refreshPromise?: Promise<InputCatalogResult>;

  constructor(storagePath: string, options: InputCatalogServiceOptions = {}) {
    this.cacheFile = path.join(storagePath, STORAGE_DIRECTORY, INPUT_CATALOG_CACHE_FILE);
    this.bundledPath = options.bundledPath;
    this.remoteUrl = options.remoteUrl ?? INPUT_CATALOG_URL;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  }

  async local(): Promise<InputCatalogResult> {
    const cached = await this.loadCache();
    if (cached) {
      return cloneResult(cached.catalog, 'cache', {
        fetchedAt: cached.fetchedAt,
        checkedAt: cached.checkedAt,
      });
    }
    return cloneResult(await this.loadBundled(), 'bundled');
  }

  async refresh(): Promise<InputCatalogResult> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.performRefresh().finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return this.refreshPromise;
  }

  private async performRefresh(): Promise<InputCatalogResult> {
    const fallback = await this.local();
    const cached = await this.loadCache();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const checkedAt = new Date().toISOString();
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'user-agent': 'homebridge-androidtv-ultimate-input-catalog',
      };
      if (cached?.etag) {
        headers['if-none-match'] = cached.etag;
      }
      const response = await this.fetcher(this.remoteUrl, { signal: controller.signal, headers });
      if (response.status === 304) {
        if (!cached) {
          throw new Error('GitHub returned not modified but no catalog cache exists');
        }
        const revalidated = { ...cached, checkedAt };
        await writePrivateJson(this.cacheFile, revalidated);
        return cloneResult(revalidated.catalog, 'cache', {
          fetchedAt: revalidated.fetchedAt,
          checkedAt,
        });
      }
      if (!response.ok) {
        throw new Error(`GitHub returned HTTP ${response.status}`);
      }
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > INPUT_CATALOG_MAX_BYTES) {
        throw new Error(`GitHub catalog exceeds ${INPUT_CATALOG_MAX_BYTES} bytes`);
      }
      const catalog = parseCatalog(await response.text());
      const fetchedAt = new Date().toISOString();
      const cache: InputCatalogCacheDocument = {
        version: 1,
        catalog,
        ...(response.headers.get('etag') ? { etag: response.headers.get('etag') ?? undefined } : {}),
        fetchedAt,
        checkedAt,
      };
      await writePrivateJson(this.cacheFile, cache);
      return cloneResult(catalog, 'remote', { fetchedAt, checkedAt });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'AbortError'
        ? 'GitHub catalog refresh timed out'
        : error instanceof Error ? error.message : String(error);
      return { ...fallback, checkedAt, warning: `${reason}. Using the last known good catalog.` };
    } finally {
      clearTimeout(timer);
    }
  }

  private async loadCache(): Promise<InputCatalogCacheDocument | undefined> {
    try {
      const value = await readJsonFile<unknown>(this.cacheFile, undefined);
      if (!isRecord(value) || value.version !== 1 || !isRecord(value.catalog)) {
        return undefined;
      }
      const fetchedAt = requiredText(value.fetchedAt, 'Catalog cache fetchedAt', 40);
      const checkedAt = requiredText(value.checkedAt, 'Catalog cache checkedAt', 40);
      const etag = optionalText(value.etag, 'Catalog cache etag', 300);
      if (Number.isNaN(Date.parse(fetchedAt)) || Number.isNaN(Date.parse(checkedAt))) {
        return undefined;
      }
      return {
        version: 1,
        catalog: validateInputCatalog(value.catalog),
        ...(etag ? { etag } : {}),
        fetchedAt,
        checkedAt,
      };
    } catch {
      return undefined;
    }
  }

  private async loadBundled(): Promise<InputCatalogDocument> {
    const candidates = this.bundledPath ? [this.bundledPath] : [
      path.join(__dirname, '..', '..', 'catalog', 'input-presets.json'),
      path.join(process.cwd(), 'catalog', 'input-presets.json'),
    ];
    for (const candidate of candidates) {
      try {
        return parseCatalog(await readFile(candidate, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
    throw new Error('Could not locate the bundled input catalog');
  }
}
