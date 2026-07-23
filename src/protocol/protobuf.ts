export type ProtoScalar = bigint | Buffer;

export interface ProtoField {
  number: number;
  wireType: number;
  value: ProtoScalar;
}

export function encodeVarint(input: number | bigint): Buffer {
  let value = BigInt(input);
  if (value < 0n) {
    value = BigInt.asUintN(64, value);
  }
  const bytes: number[] = [];
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value > 0n) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (value > 0n);
  return Buffer.from(bytes);
}

export function decodeVarint(buffer: Buffer, offset = 0): { value: bigint; bytes: number } | undefined {
  let result = 0n;
  let shift = 0n;
  for (let index = offset; index < buffer.length && index < offset + 10; index += 1) {
    const byte = buffer[index];
    if (byte === undefined) {
      return undefined;
    }
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result, bytes: index - offset + 1 };
    }
    shift += 7n;
  }
  return undefined;
}

export class ProtoWriter {
  private readonly chunks: Buffer[] = [];

  varint(field: number, value: number | bigint): this {
    this.chunks.push(encodeVarint((field << 3) | 0), encodeVarint(value));
    return this;
  }

  bool(field: number, value: boolean): this {
    return this.varint(field, value ? 1 : 0);
  }

  bytes(field: number, value: Buffer): this {
    this.chunks.push(encodeVarint((field << 3) | 2), encodeVarint(value.length), value);
    return this;
  }

  string(field: number, value: string): this {
    return this.bytes(field, Buffer.from(value, 'utf8'));
  }

  message(field: number, callback: (writer: ProtoWriter) => void): this {
    const writer = new ProtoWriter();
    callback(writer);
    return this.bytes(field, writer.finish());
  }

  finish(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

export function decodeFields(buffer: Buffer): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tag = decodeVarint(buffer, offset);
    if (!tag) {
      throw new Error('Incomplete protobuf tag');
    }
    offset += tag.bytes;
    const number = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (number === 0) {
      throw new Error('Invalid protobuf field 0');
    }
    if (wireType === 0) {
      const value = decodeVarint(buffer, offset);
      if (!value) {
        throw new Error(`Incomplete protobuf varint for field ${number}`);
      }
      fields.push({ number, wireType, value: value.value });
      offset += value.bytes;
      continue;
    }
    if (wireType === 2) {
      const length = decodeVarint(buffer, offset);
      if (!length) {
        throw new Error(`Incomplete protobuf length for field ${number}`);
      }
      offset += length.bytes;
      const byteLength = Number(length.value);
      if (!Number.isSafeInteger(byteLength) || offset + byteLength > buffer.length) {
        throw new Error(`Invalid protobuf length for field ${number}`);
      }
      fields.push({ number, wireType, value: buffer.subarray(offset, offset + byteLength) });
      offset += byteLength;
      continue;
    }
    if (wireType === 1) {
      if (offset + 8 > buffer.length) {
        throw new Error(`Incomplete protobuf fixed64 for field ${number}`);
      }
      fields.push({ number, wireType, value: buffer.subarray(offset, offset + 8) });
      offset += 8;
      continue;
    }
    if (wireType === 5) {
      if (offset + 4 > buffer.length) {
        throw new Error(`Incomplete protobuf fixed32 for field ${number}`);
      }
      fields.push({ number, wireType, value: buffer.subarray(offset, offset + 4) });
      offset += 4;
      continue;
    }
    throw new Error(`Unsupported protobuf wire type ${wireType}`);
  }
  return fields;
}

export function firstBytes(fields: ProtoField[], number: number): Buffer | undefined {
  const value = fields.find(field => field.number === number && Buffer.isBuffer(field.value))?.value;
  return Buffer.isBuffer(value) ? value : undefined;
}

export function firstNumber(fields: ProtoField[], number: number): number | undefined {
  const value = fields.find(field => field.number === number && typeof field.value === 'bigint')?.value;
  return typeof value === 'bigint' ? Number(value) : undefined;
}
