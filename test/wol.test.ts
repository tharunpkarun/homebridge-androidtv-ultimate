import assert from 'node:assert/strict';
import test from 'node:test';
import { createMagicPacket } from '../src/network/wol';

test('Wake-on-LAN packet contains 16 copies of the MAC address', () => {
  const packet = createMagicPacket('AA:BB:CC:DD:EE:FF');
  assert.equal(packet.length, 102);
  assert.deepEqual(packet.subarray(0, 6), Buffer.alloc(6, 0xff));
  for (let offset = 6; offset < packet.length; offset += 6) {
    assert.equal(packet.subarray(offset, offset + 6).toString('hex'), 'aabbccddeeff');
  }
});

test('Wake-on-LAN rejects malformed addresses', () => {
  assert.throws(() => createMagicPacket('not-a-mac'), /Invalid Wake-on-LAN/);
});
