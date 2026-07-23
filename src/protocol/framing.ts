import { decodeVarint, encodeVarint } from './protobuf';

const MAX_FRAME_LENGTH = 8 * 1024 * 1024;

export function frameMessage(message: Buffer): Buffer {
  if (message.length > MAX_FRAME_LENGTH) {
    throw new Error('Android TV frame exceeds the 8 MiB limit');
  }
  return Buffer.concat([encodeVarint(message.length), message]);
}

export class FrameDecoder {
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    const frames: Buffer[] = [];
    while (this.pending.length > 0) {
      const header = decodeVarint(this.pending);
      if (!header) {
        if (this.pending.length > 10) {
          throw new Error('Invalid Android TV frame prefix');
        }
        break;
      }
      const length = Number(header.value);
      if (!Number.isSafeInteger(length) || length > MAX_FRAME_LENGTH) {
        throw new Error('Invalid Android TV frame length');
      }
      const end = header.bytes + length;
      if (this.pending.length < end) {
        break;
      }
      frames.push(this.pending.subarray(header.bytes, end));
      this.pending = this.pending.subarray(end);
    }
    return frames;
  }

  reset(): void {
    this.pending = Buffer.alloc(0);
  }
}
