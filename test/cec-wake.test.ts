import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateCecWakeHelper,
  isCecWakeHelperRouteAvailable,
  resolveCecWakeConfig,
  runCecWakeAttempt,
} from '../src/power/cec-wake';

test('CEC helper availability requires pairing and a dispatchable connection or WOL route', () => {
  assert.equal(isCecWakeHelperRouteAvailable({
    paired: false, connection: 'online', wakeOnLanEnabled: true, mac: 'AA:BB:CC:DD:EE:FF',
  }), false);
  assert.equal(isCecWakeHelperRouteAvailable({
    paired: true, connection: 'connecting', wakeOnLanEnabled: false,
  }), true);
  assert.equal(isCecWakeHelperRouteAvailable({
    paired: true, connection: 'offline', wakeOnLanEnabled: true, mac: 'AA:BB:CC:DD:EE:FF',
  }), true);
  assert.equal(isCecWakeHelperRouteAvailable({
    paired: true, connection: 'offline', wakeOnLanEnabled: false, mac: 'AA:BB:CC:DD:EE:FF',
  }), false);
});

test('CEC wake configuration applies safe defaults and bounds', () => {
  assert.deepEqual(resolveCecWakeConfig({ helperDeviceId: ' set-top-box ' }), {
    helperDeviceId: 'set-top-box',
    powerToHomeDelayMs: 1_500,
    confirmationTimeoutMs: 30_000,
    failureBehavior: 'remainOff',
  });
  assert.deepEqual(resolveCecWakeConfig({
    helperDeviceId: 'box',
    powerToHomeDelayMs: 20_000,
    confirmationTimeoutSeconds: 2,
    failureBehavior: 'noResponse',
  }), {
    helperDeviceId: 'box',
    powerToHomeDelayMs: 10_000,
    confirmationTimeoutMs: 10_000,
    failureBehavior: 'noResponse',
  });
  assert.equal(resolveCecWakeConfig({ helperDeviceId: '  ' }), undefined);
});

test('CEC wake reports unavailable when no route can be dispatched', async () => {
  const result = await runCecWakeAttempt({
    routes: [],
    confirmationTimeoutMs: 10,
    isTargetOnline: () => false,
  });
  assert.equal(result, 'unavailable');
});

test('CEC helper powers on and sends Home even when it is already online', async () => {
  const commands: string[] = [];
  await activateCecWakeHelper({
    name: 'Set-top Box',
    connection: () => 'online',
    stopped: () => false,
    setPowerOn: async () => { commands.push('power'); },
    sendHome: async () => { commands.push('home'); },
    powerToHomeDelayMs: 0,
    timeoutMs: 100,
  });
  assert.deepEqual(commands, ['power', 'home']);
});

test('CEC helper uses its own WOL before Power and Home when offline', async () => {
  const commands: string[] = [];
  let connection: 'offline' | 'online' = 'offline';
  await activateCecWakeHelper({
    name: 'Set-top Box',
    connection: () => connection,
    stopped: () => false,
    dispatchWakeOnLan: async () => { commands.push('wol'); connection = 'online'; },
    setPowerOn: async () => { commands.push('power'); },
    sendHome: async () => { commands.push('home'); },
    powerToHomeDelayMs: 0,
    timeoutMs: 100,
    pollIntervalMs: 1,
  });
  assert.deepEqual(commands, ['wol', 'power', 'home']);
});

test('CEC helper fails cleanly when offline without WOL', async () => {
  await assert.rejects(activateCecWakeHelper({
    name: 'Set-top Box',
    connection: () => 'offline',
    stopped: () => false,
    setPowerOn: async () => undefined,
    sendHome: async () => undefined,
    powerToHomeDelayMs: 0,
    timeoutMs: 10,
  }), /no usable Wake-on-LAN/);
});

test('CEC wake dispatches Wake-on-LAN and helper routes in parallel', async () => {
  let activeRoutes = 0;
  let maximumActiveRoutes = 0;
  let targetOnline = false;
  const dispatch = async (): Promise<void> => {
    activeRoutes += 1;
    maximumActiveRoutes = Math.max(maximumActiveRoutes, activeRoutes);
    await new Promise(resolve => setTimeout(resolve, 5));
    activeRoutes -= 1;
    targetOnline = true;
  };
  const result = await runCecWakeAttempt({
    routes: [
      { name: 'Wake-on-LAN', dispatch },
      { name: 'CEC helper', dispatch },
    ],
    confirmationTimeoutMs: 100,
    isTargetOnline: () => targetOnline,
  });
  assert.equal(maximumActiveRoutes, 2);
  assert.equal(result, 'online');
});

test('CEC wake distinguishes failed dispatch from unconfirmed wake', async () => {
  const failures: string[] = [];
  const failed = await runCecWakeAttempt({
    routes: [{ name: 'CEC helper', dispatch: async () => { throw new Error('offline'); } }],
    confirmationTimeoutMs: 20,
    isTargetOnline: () => false,
    onRouteFailure: route => failures.push(route.name),
  });
  assert.equal(failed, 'failed');
  assert.deepEqual(failures, ['CEC helper']);

  const timedOut = await runCecWakeAttempt({
    routes: [{ name: 'Wake-on-LAN', dispatch: async () => undefined }],
    confirmationTimeoutMs: 10,
    isTargetOnline: () => false,
    pollIntervalMs: 1,
  });
  assert.equal(timedOut, 'timeout');
});
