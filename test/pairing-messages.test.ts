import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PairingField,
  encodePairingConfiguration,
  encodePairingOption,
  encodePairingRequest,
  pairingMessageType,
} from '../src/protocol/pairing-messages';
import { decodeFields, firstBytes, firstNumber } from '../src/protocol/protobuf';

test('pairing request uses the Android pairing envelope', () => {
  const request = encodePairingRequest('homebridge', 'Living Room');
  assert.equal(pairingMessageType(request), PairingField.REQUEST);
  const payload = firstBytes(decodeFields(request), PairingField.REQUEST);
  assert.ok(payload);
  const fields = decodeFields(payload);
  assert.equal((firstBytes(fields, 1))?.toString(), 'homebridge');
  assert.equal((firstBytes(fields, 2))?.toString(), 'Living Room');
});

test('pairing option advertises input role and six-symbol hexadecimal encoding', () => {
  const payload = firstBytes(decodeFields(encodePairingOption()), PairingField.OPTION);
  assert.ok(payload);
  const fields = decodeFields(payload);
  assert.equal(firstNumber(fields, 1), 1);
  const input = firstBytes(fields, 2);
  const output = firstBytes(fields, 3);
  assert.ok(input);
  assert.ok(output);
  assert.equal(firstNumber(decodeFields(input), 1), 3);
  assert.equal(firstNumber(decodeFields(input), 2), 6);
});

test('pairing configuration selects the input role', () => {
  const payload = firstBytes(decodeFields(encodePairingConfiguration()), PairingField.CONFIGURATION);
  assert.ok(payload);
  assert.equal(firstNumber(decodeFields(payload), 1), 1);
});
