import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AndroidKeyCode,
  RemoteField,
  decodeRemoteMessage,
  encodeAppLaunch,
  encodeConfigure,
  encodeKey,
  encodePingResponse,
  encodeSetActive,
  normalizeAppLaunchUri,
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

test('app launch converts package IDs to Remote Service v2 market launch links', () => {
  assert.equal(normalizeAppLaunchUri(' com.netflix.ninja '), 'market://launch?id=com.netflix.ninja');
  const launch = firstBytes(decodeFields(encodeAppLaunch('com.netflix.ninja')), RemoteField.APP_LINK_LAUNCH_REQUEST);
  assert.ok(launch);
  assert.equal(firstBytes(decodeFields(launch), 1)?.toString(), 'market://launch?id=com.netflix.ninja');
});

test('app launch preserves explicit URI schemes', () => {
  for (const uri of [
    'https://example.com/watch',
    'intent://watch#Intent;scheme=example;end',
    'market://launch?id=com.example.app',
    'example-app://browse',
  ]) {
    assert.equal(normalizeAppLaunchUri(` ${uri} `), uri);
  }
});

test('app launch rejects an empty command', () => {
  assert.throws(() => encodeAppLaunch('   '), /cannot be empty/);
});

test('configure and set-active replies use the Remote Service v2 feature mask', () => {
  const configure = firstBytes(decodeFields(encodeConfigure()), RemoteField.CONFIGURE);
  assert.ok(configure);
  const configureFields = decodeFields(configure);
  assert.equal(firstNumber(configureFields, 1), 622);
  const deviceInfo = firstBytes(configureFields, 2);
  assert.ok(deviceInfo);
  const deviceFields = decodeFields(deviceInfo);
  assert.equal(firstNumber(deviceFields, 3), 1);
  assert.equal(firstBytes(deviceFields, 4)?.toString(), '1');

  const active = firstBytes(decodeFields(encodeSetActive()), RemoteField.SET_ACTIVE);
  assert.ok(active);
  assert.equal(firstNumber(decodeFields(active), 1), 622);
});

test('ping request is decoded and response echoes only the protocol-defined value', () => {
  const request = new ProtoWriter().message(RemoteField.PING_REQUEST, writer => writer.varint(1, 7).varint(2, 9)).finish();
  assert.deepEqual(decodeRemoteMessage(request), { type: 'ping', ping: { value1: 7, value2: 9 } });
  const response = firstBytes(decodeFields(encodePingResponse(7)), RemoteField.PING_RESPONSE);
  assert.ok(response);
  const fields = decodeFields(response);
  assert.equal(firstNumber(fields, 1), 7);
  assert.equal(firstNumber(fields, 2), undefined);
});

test('ready and volume reports use the canonical Remote Service v2 fields', () => {
  const setActive = new ProtoWriter().message(RemoteField.SET_ACTIVE, writer => writer.varint(1, 615)).finish();
  assert.deepEqual(decodeRemoteMessage(setActive), { type: 'setActive', features: 615 });

  const start = new ProtoWriter().message(RemoteField.START, writer => writer.bool(1, true)).finish();
  assert.deepEqual(decodeRemoteMessage(start), { type: 'start', started: true });

  const volume = new ProtoWriter().message(RemoteField.SET_VOLUME_LEVEL, writer => {
    writer.varint(6, 15).varint(7, 5).bool(8, true);
  }).finish();
  assert.deepEqual(decodeRemoteMessage(volume), {
    type: 'volume',
    volume: 5,
    volumeMax: 15,
    muted: true,
  });
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
