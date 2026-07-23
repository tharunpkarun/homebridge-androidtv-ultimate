import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameDecoder, frameMessage } from '../src/protocol/framing';
import { ProtoWriter, decodeFields, firstNumber } from '../src/protocol/protobuf';

test('protobuf writer and reader preserve nested values', () => {
  const encoded = new ProtoWriter()
    .varint(1, 622)
    .string(2, 'Android TV')
    .message(3, nested => nested.bool(1, true))
    .finish();
  const fields = decodeFields(encoded);
  assert.equal(firstNumber(fields, 1), 622);
  assert.equal((fields[1]?.value as Buffer).toString(), 'Android TV');
  assert.equal(firstNumber(decodeFields(fields[2]?.value as Buffer), 1), 1);
});

test('frame decoder handles split and coalesced TLS chunks', () => {
  const first = frameMessage(Buffer.from('first'));
  const second = frameMessage(Buffer.alloc(300, 0x5a));
  const stream = Buffer.concat([first, second]);
  const decoder = new FrameDecoder();
  assert.deepEqual(decoder.push(stream.subarray(0, 2)), []);
  const frames = decoder.push(stream.subarray(2));
  assert.equal(frames.length, 2);
  assert.equal(frames[0]?.toString(), 'first');
  assert.equal(frames[1]?.length, 300);
});
