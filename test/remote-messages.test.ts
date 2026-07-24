import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AndroidKeyCode,
  RemoteField,
  decodeRemoteMessage,
  encodeKey,
  encodePingResponse,
} from '../src/protocol/remote-messages';
import { ProtoWriter, decodeFields, firstBytes, firstNumber } from '../src/protocol/protobuf';

test('key injection uses the Remote Service v2 field numbers', () => {
  const outer = decodeFields(encodeKey(AndroidKeyCode.HOME));
  const key = firstBytes(outer, RemoteField.KEY_INJECT);
  assert.ok(key);
  const fields = decodeFields(key);
  assert.equal(firstNumber(fields, 1), AndroidKeyCode.HOME);
  assert.equal(firstNumber(fields, 2), 3);
});

test('ping request is decoded and response echoes both values', () => {
  const request = new ProtoWriter().message(RemoteField.PING_REQUEST, writer => writer.varint(1, 7).varint(2, 9)).finish();
  assert.deepEqual(decodeRemoteMessage(request), { type: 'ping', ping: { value1: 7, value2: 9 } });
  const response = firstBytes(decodeFields(encodePingResponse(7, 9)), RemoteField.PING_RESPONSE);
  assert.ok(response);
  assert.equal(firstNumber(decodeFields(response), 1), 7);
  assert.equal(firstNumber(decodeFields(response), 2), 9);
});

test('foreground Android package is decoded from Remote Service v2 IME status', () => {
  const message = new ProtoWriter().message(RemoteField.IME_KEY_INJECT, ime => {
    ime.message(1, appInfo => appInfo.string(12, 'com.example.streaming'));
  }).finish();
  assert.deepEqual(decodeRemoteMessage(message), {
    type: 'app',
    currentApp: 'com.example.streaming',
  });
});
