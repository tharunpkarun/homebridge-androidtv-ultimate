import assert from 'node:assert/strict';
import test from 'node:test';
import type { TLSSocket } from 'node:tls';
import { FrameDecoder } from '../src/protocol/framing';
import { AndroidKeyCode, RemoteField } from '../src/protocol/remote-messages';
import { ProtoWriter, decodeFields, firstBytes, firstNumber } from '../src/protocol/protobuf';
import { RemoteServiceV2Transport } from '../src/protocol/v2-transport';
import type { DeviceCredentials } from '../src/types';

const credentials: DeviceCredentials = {
  deviceId: 'tv',
  certificate: 'certificate',
  privateKey: 'key',
  clientName: 'Homebridge TV',
  fingerprint: 'fingerprint',
  pairedAt: '2026-01-01T00:00:00.000Z',
  protocol: 'remote-service-v2',
};

interface TransportInternals {
  stopped: boolean;
  socket?: TLSSocket;
  handleMessage(message: Buffer): void;
}

function unframe(frame: Buffer): Buffer {
  const messages = new FrameDecoder().push(frame);
  assert.equal(messages.length, 1);
  return messages[0]!;
}

function nestedField(frame: Buffer, field: number): Buffer {
  const nested = firstBytes(decodeFields(unframe(frame)), field);
  assert.ok(nested);
  return nested;
}

test('transport waits for the server-led handshake before sending commands', async () => {
  const transport = new RemoteServiceV2Transport({ id: 'tv', name: 'TV', host: '192.0.2.20' }, credentials);
  const internals = transport as unknown as TransportInternals;
  const writes: Buffer[] = [];
  internals.stopped = false;
  internals.socket = {
    writable: true,
    write: (value: Buffer) => { writes.push(value); return true; },
    destroy: () => undefined,
  } as unknown as TLSSocket;

  const pendingKey = transport.sendKey(AndroidKeyCode.HOME);
  await Promise.resolve();
  assert.equal(writes.length, 0);

  internals.handleMessage(new ProtoWriter().message(RemoteField.CONFIGURE, writer => writer.varint(1, 622)).finish());
  assert.equal(firstNumber(decodeFields(nestedField(writes[0]!, RemoteField.CONFIGURE)), 1), 622);

  internals.handleMessage(new ProtoWriter().message(RemoteField.SET_ACTIVE, writer => writer.varint(1, 622)).finish());
  assert.equal(firstNumber(decodeFields(nestedField(writes[1]!, RemoteField.SET_ACTIVE)), 1), 622);

  internals.handleMessage(new ProtoWriter().message(RemoteField.START, writer => writer.bool(1, true)).finish());
  await pendingKey;
  assert.equal(transport.snapshot.connection, 'online');
  assert.equal(transport.snapshot.power, true);
  assert.equal(firstNumber(decodeFields(nestedField(writes[2]!, RemoteField.KEY_INJECT)), 1), AndroidKeyCode.HOME);

  await transport.launchApp('com.netflix.ninja');
  assert.equal(
    firstBytes(decodeFields(nestedField(writes[3]!, RemoteField.APP_LINK_LAUNCH_REQUEST)), 1)?.toString(),
    'market://launch?id=com.netflix.ninja',
  );

  transport.stop();
});

test('power, volume, and mute use portable Android key commands', async () => {
  const transport = new RemoteServiceV2Transport({ id: 'tv', name: 'TV', host: '192.0.2.21' }, credentials);
  const internals = transport as unknown as TransportInternals;
  const writes: Buffer[] = [];
  internals.stopped = false;
  internals.socket = {
    writable: true,
    write: (value: Buffer) => { writes.push(value); return true; },
    destroy: () => undefined,
  } as unknown as TLSSocket;
  internals.handleMessage(new ProtoWriter().message(RemoteField.START, writer => writer.bool(1, true)).finish());
  internals.handleMessage(new ProtoWriter().message(RemoteField.SET_VOLUME_LEVEL, writer => {
    writer.varint(6, 10).varint(7, 5).bool(8, false);
  }).finish());

  await transport.setPower(false);
  await transport.setVolume(70);
  await transport.setMuted(true);

  const keyCodes = writes.map(frame => firstNumber(decodeFields(nestedField(frame, RemoteField.KEY_INJECT)), 1));
  assert.deepEqual(keyCodes, [AndroidKeyCode.POWER, AndroidKeyCode.VOLUME_UP, AndroidKeyCode.VOLUME_UP, AndroidKeyCode.MUTE]);
  assert.equal(transport.snapshot.power, false);
  assert.equal(transport.snapshot.volume, 70);
  assert.equal(transport.snapshot.muted, true);

  transport.stop();
});
