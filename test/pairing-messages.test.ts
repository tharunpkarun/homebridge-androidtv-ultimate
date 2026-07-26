import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PairingField,
  encodePairingConfiguration,
  encodePairingOption,
  encodePairingRequest,
  pairingMessageType,
  pairingStatus,
} from '../src/protocol/pairing-messages';
import { decodeFields, firstBytes, firstNumber } from '../src/protocol/protobuf';

test('pairing request uses the Android pairing envelope', () => {
  const request = encodePairingRequest('homebridge', 'Living Room');
  assert.equal(pairingMessageType(request), PairingField.REQUEST);
  assert.equal(firstNumber(decodeFields(request), 1), 2);
  assert.equal(pairingStatus(request), 200);
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
  assert.equal(firstNumber(fields, 3), 1);
  const input = firstBytes(fields, 1);
  const output = firstBytes(fields, 2);
  assert.ok(input);
  assert.equal(output, undefined);
  assert.equal(firstNumber(decodeFields(input), 1), 3);
  assert.equal(firstNumber(decodeFields(input), 2), 6);
});

test('pairing configuration selects the input role', () => {
  const payload = firstBytes(decodeFields(encodePairingConfiguration()), PairingField.CONFIGURATION);
  assert.ok(payload);
  const fields = decodeFields(payload);
  assert.equal(firstNumber(fields, 2), 1);
  const encoding = firstBytes(fields, 1);
  assert.ok(encoding);
  assert.equal(firstNumber(decodeFields(encoding), 1), 3);
  assert.equal(firstNumber(decodeFields(encoding), 2), 6);
});

test('pairing messages match the established Remote Service v2 wire format', () => {
  assert.equal(
    encodePairingRequest('homebridge', 'Living Room').toString('hex'),
    '080210c80152190a0a686f6d65627269646765120b4c6976696e6720526f6f6d',
  );
  assert.equal(encodePairingOption().toString('hex'), '080210c801a201080a04080310061801');
  assert.equal(encodePairingConfiguration().toString('hex'), '080210c801f201080a04080310061001');
});
