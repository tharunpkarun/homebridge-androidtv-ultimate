import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inputTestResult,
  validateInputTestCommand,
} from '../src/input/input-test';

test('input testing validates app packages, deep links, and Android key commands', () => {
  assert.deepEqual(validateInputTestCommand({
    name: 'Netflix',
    uri: 'com.netflix.ninja',
  }), {
    kind: 'uri',
    uri: 'com.netflix.ninja',
    expectedPackage: 'com.netflix.ninja',
  });
  assert.deepEqual(validateInputTestCommand({
    name: 'Streaming App',
    uri: 'example-app://browse',
    packageName: 'com.example.streaming',
  }), {
    kind: 'uri',
    uri: 'example-app://browse',
    expectedPackage: 'com.example.streaming',
  });
  assert.deepEqual(validateInputTestCommand({
    name: 'HDMI 1',
    keyCode: 243,
  }), {
    kind: 'keyCode',
    keyCode: 243,
    expectedPackage: undefined,
  });
});

test('input testing rejects ambiguous and malformed commands', () => {
  assert.throws(() => validateInputTestCommand(), /Enter an app package/);
  assert.throws(() => validateInputTestCommand({
    name: 'Ambiguous', uri: 'com.example.tv', keyCode: 243,
  }), /either/);
  assert.throws(() => validateInputTestCommand({ name: 'Empty' }), /Enter an app package/);
  assert.throws(() => validateInputTestCommand({
    name: 'Bad link', uri: 'example.com/watch',
  }), /URI with a scheme/);
  assert.throws(() => validateInputTestCommand({
    name: 'Bad key', keyCode: 1001,
  }), /0 to 1000/);
  assert.throws(() => validateInputTestCommand({
    name: 'Bad package', uri: 'example-app://browse', packageName: 'not a package',
  }), /valid package ID/);
});

test('input testing distinguishes matching, different, observed, and unconfirmed packages', () => {
  const packageCommand = validateInputTestCommand({ name: 'Netflix', uri: 'com.netflix.ninja' });
  assert.equal(inputTestResult(packageCommand, 'com.netflix.ninja').confirmation, 'matched');
  assert.equal(inputTestResult(packageCommand, 'com.example.launcher').confirmation, 'different');

  const keyCommand = validateInputTestCommand({ name: 'HDMI 1', keyCode: 243 });
  assert.equal(inputTestResult(keyCommand, 'com.example.tvinput').confirmation, 'observed');
  assert.equal(inputTestResult(keyCommand).confirmation, 'unconfirmed');
  assert.equal(inputTestResult(keyCommand, 'invalid package').observedPackage, undefined);
});
