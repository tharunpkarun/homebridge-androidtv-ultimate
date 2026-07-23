import { createHash } from 'node:crypto';
import dgram from 'node:dgram';
import type { DiscoveredAndroidTv } from '../types';

const SERVICE = '_androidtvremote2._tcp.local';
const MDNS_ADDRESS = '224.0.0.251';
const MDNS_PORT = 5353;

export interface DnsRecord {
  name: string;
  type: number;
  data: string | { port: number; target: string } | Record<string, string>;
}

function encodeName(name: string): Buffer {
  const labels = name.split('.').filter(Boolean);
  const chunks = labels.map(label => {
    const value = Buffer.from(label, 'utf8');
    if (value.length > 63) {
      throw new Error('mDNS label exceeds 63 bytes');
    }
    return Buffer.concat([Buffer.from([value.length]), value]);
  });
  return Buffer.concat([...chunks, Buffer.from([0])]);
}

export function createDiscoveryQuery(): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4);
  const question = Buffer.alloc(4);
  question.writeUInt16BE(12, 0);
  question.writeUInt16BE(1, 2);
  return Buffer.concat([header, encodeName(SERVICE), question]);
}

function readName(message: Buffer, start: number, visited = new Set<number>()): { name: string; offset: number } {
  const labels: string[] = [];
  let cursor = start;
  let nextOffset = start;
  let jumped = false;
  while (cursor < message.length) {
    const length = message[cursor];
    if (length === undefined) {
      throw new Error('Incomplete DNS name');
    }
    if ((length & 0xc0) === 0xc0) {
      const second = message[cursor + 1];
      if (second === undefined) {
        throw new Error('Incomplete DNS compression pointer');
      }
      const pointer = ((length & 0x3f) << 8) | second;
      if (visited.has(pointer)) {
        throw new Error('Cyclic DNS compression pointer');
      }
      visited.add(pointer);
      const suffix = readName(message, pointer, visited).name;
      if (suffix) {
        labels.push(suffix);
      }
      if (!jumped) {
        nextOffset = cursor + 2;
      }
      jumped = true;
      break;
    }
    cursor += 1;
    if (length === 0) {
      if (!jumped) {
        nextOffset = cursor;
      }
      break;
    }
    if (cursor + length > message.length) {
      throw new Error('Incomplete DNS label');
    }
    labels.push(message.toString('utf8', cursor, cursor + length));
    cursor += length;
    if (!jumped) {
      nextOffset = cursor;
    }
  }
  return { name: labels.join('.'), offset: nextOffset };
}

function parseTxt(data: Buffer): Record<string, string> {
  const result: Record<string, string> = {};
  let offset = 0;
  while (offset < data.length) {
    const length = data[offset] ?? 0;
    offset += 1;
    const entry = data.toString('utf8', offset, offset + length);
    offset += length;
    const separator = entry.indexOf('=');
    result[separator < 0 ? entry : entry.slice(0, separator)] = separator < 0 ? '' : entry.slice(separator + 1);
  }
  return result;
}

function parsePacket(message: Buffer): DnsRecord[] {
  if (message.length < 12) {
    return [];
  }
  const questions = message.readUInt16BE(4);
  const recordCount = message.readUInt16BE(6) + message.readUInt16BE(8) + message.readUInt16BE(10);
  let offset = 12;
  for (let index = 0; index < questions; index += 1) {
    offset = readName(message, offset).offset + 4;
  }
  const records: DnsRecord[] = [];
  for (let index = 0; index < recordCount && offset < message.length; index += 1) {
    const decodedName = readName(message, offset);
    offset = decodedName.offset;
    if (offset + 10 > message.length) {
      break;
    }
    const type = message.readUInt16BE(offset);
    const dataLength = message.readUInt16BE(offset + 8);
    const dataOffset = offset + 10;
    const dataEnd = dataOffset + dataLength;
    if (dataEnd > message.length) {
      break;
    }
    let data: DnsRecord['data'] | undefined;
    if (type === 12) {
      data = readName(message, dataOffset).name;
    } else if (type === 33 && dataLength >= 6) {
      data = { port: message.readUInt16BE(dataOffset + 4), target: readName(message, dataOffset + 6).name };
    } else if (type === 16) {
      data = parseTxt(message.subarray(dataOffset, dataEnd));
    } else if (type === 1 && dataLength === 4) {
      data = [...message.subarray(dataOffset, dataEnd)].join('.');
    } else if (type === 28 && dataLength === 16) {
      const groups: string[] = [];
      for (let cursor = dataOffset; cursor < dataEnd; cursor += 2) {
        groups.push(message.readUInt16BE(cursor).toString(16));
      }
      data = groups.join(':');
    }
    if (data !== undefined) {
      records.push({ name: decodedName.name, type, data });
    }
    offset = dataEnd;
  }
  return records;
}

function stableId(value: string): string {
  return createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 16);
}

export function normalizeMac(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const compact = value.replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(compact)) {
    return undefined;
  }
  return compact.match(/.{2}/g)?.join(':');
}

export function recordsToDevices(records: DnsRecord[]): DiscoveredAndroidTv[] {
  const instances = new Set(
    records.filter(record => record.type === 12 && record.name.toLowerCase() === SERVICE)
      .map(record => String(record.data)),
  );
  for (const record of records.filter(record => record.type === 33)) {
    if (record.name.toLowerCase().endsWith(`.${SERVICE}`)) {
      instances.add(record.name);
    }
  }

  const devices: DiscoveredAndroidTv[] = [];
  for (const instance of instances) {
    const service = records.find(record => record.type === 33 && record.name === instance)?.data;
    if (!service || typeof service === 'string' || !('port' in service)
      || typeof service.port !== 'number' || typeof service.target !== 'string') {
      continue;
    }
    const txtValue = records.find(record => record.type === 16 && record.name === instance)?.data;
    const txt = txtValue && typeof txtValue !== 'string' && !('port' in txtValue) ? txtValue : {};
    const ipv4 = records.find(record => record.type === 1 && record.name === service.target)?.data;
    const ipv6 = records.find(record => record.type === 28 && record.name === service.target)?.data;
    const address = ipv4 ?? ipv6;
    const host = typeof address === 'string' ? address : service.target.replace(/\.$/, '');
    const name = instance.replace(new RegExp(`\\.${SERVICE.replace(/\./g, '\\.')}$`, 'i'), '');
    const mac = normalizeMac(txt.mac || txt.macaddress || txt.device_mac || txt.deviceid);
    const discoveryId = txt.id || txt.deviceid || txt.bt || mac || service.target || instance;
    devices.push({
      id: stableId(discoveryId),
      discoveryId,
      name,
      host,
      port: service.port,
      serviceName: instance,
      hostname: service.target.replace(/\.$/, ''),
      mac,
      model: txt.md || txt.model,
      manufacturer: txt.manufacturer || txt.vendor,
      txt,
    });
  }
  return devices.sort((left, right) => left.name.localeCompare(right.name));
}

export async function discoverAndroidTvs(timeoutMs = 4000): Promise<DiscoveredAndroidTv[]> {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const records: DnsRecord[] = [];
  const query = createDiscoveryQuery();
  return new Promise<DiscoveredAndroidTv[]>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) {
        reject(error);
      } else {
        resolve(recordsToDevices(records));
      }
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    socket.on('message', message => {
      try {
        records.push(...parsePacket(message));
      } catch {
        // Ignore malformed packets from unrelated mDNS services.
      }
    });
    socket.once('error', error => finish(error));
    socket.bind({ port: MDNS_PORT, exclusive: false }, () => {
      try {
        socket.addMembership(MDNS_ADDRESS);
        socket.setMulticastTTL(2);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      socket.send(query, MDNS_PORT, MDNS_ADDRESS, error => {
        if (error) {
          finish(error);
        }
      });
      const retry = setTimeout(() => {
        if (!settled) {
          socket.send(query, MDNS_PORT, MDNS_ADDRESS);
        }
      }, Math.min(1000, Math.floor(timeoutMs / 2)));
      retry.unref();
    });
  });
}
