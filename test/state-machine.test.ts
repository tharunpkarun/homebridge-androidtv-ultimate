import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceStateMachine } from '../src/protocol/state-machine';

test('offline is the initial state and never defaults to on', () => {
  const state = new DeviceStateMachine(5);
  assert.deepEqual(state.snapshot, { connection: 'offline', power: false });
});

test('a disconnect changes power to off after the grace period', async () => {
  const state = new DeviceStateMachine(10);
  state.connecting();
  state.connected();
  assert.equal(state.snapshot.power, true);
  state.disconnected(new Error('connection refused'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(state.snapshot.connection, 'offline');
  assert.equal(state.snapshot.power, false);
  assert.equal(state.snapshot.error, 'connection refused');
});

test('a reconnect during the grace period prevents a false off transition', async () => {
  const state = new DeviceStateMachine(20);
  state.connected();
  state.disconnected();
  state.connecting();
  state.connected();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(state.snapshot.connection, 'online');
  assert.equal(state.snapshot.power, true);
});

test('a new connection clears stale foreground app state until the TV confirms it', () => {
  const state = new DeviceStateMachine(20);
  state.connected();
  state.reportApp('com.example.streaming');
  assert.equal(state.snapshot.currentApp, 'com.example.streaming');
  state.connecting();
  assert.equal(state.snapshot.currentApp, undefined);
  state.reportApp('com.example.streaming');
  state.connected();
  assert.equal(state.snapshot.currentApp, undefined);
});

test('powering off clears the active app', () => {
  const state = new DeviceStateMachine();
  state.connected();
  state.reportApp('com.example.streaming');
  state.reportPower(false);
  assert.equal(state.snapshot.currentApp, undefined);
});
