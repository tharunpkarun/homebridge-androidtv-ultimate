import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_KEY_MAPPINGS, controlDefaults, inputSourceType, resolveControlOptions } from '../src/homekit/controls';
import { AndroidKeyCode } from '../src/protocol/remote-messages';

test('television-like profiles keep the complete backward-compatible control set', () => {
  for (const deviceType of ['television', 'settopbox', 'streamingstick', 'appletv', 'audioreceiver'] as const) {
    assert.deepEqual(controlDefaults(deviceType), {
      power: true,
      remote: true,
      media: true,
      volume: true,
      mute: true,
      inputs: true,
      wakeOnLan: true,
    });
  }
});

test('speaker and HomePod profiles use focused service defaults', () => {
  assert.deepEqual(controlDefaults('speaker'), {
    power: true,
    remote: false,
    media: false,
    volume: true,
    mute: true,
    inputs: false,
    wakeOnLan: true,
  });
  assert.deepEqual(controlDefaults('homepod'), {
    power: false,
    remote: false,
    media: true,
    volume: true,
    mute: true,
    inputs: false,
    wakeOnLan: false,
  });
});

test('configured control and Android key overrides merge with profile defaults', () => {
  const controls = resolveControlOptions({
    deviceType: 'speaker',
    controls: { remote: true, volume: false, keyMappings: { home: 222, play: 333 } },
  });
  assert.equal(controls.remote, true);
  assert.equal(controls.media, false);
  assert.equal(controls.volume, false);
  assert.equal(controls.keyMappings.home, 222);
  assert.equal(controls.keyMappings.play, 333);
  assert.equal(controls.keyMappings.select, AndroidKeyCode.DPAD_CENTER);
});

test('invalid hand-written key overrides fall back to Android defaults', () => {
  const controls = resolveControlOptions({
    controls: { keyMappings: { home: -1, menu: 1001, info: Number.NaN } },
  });
  assert.equal(controls.keyMappings.home, AndroidKeyCode.HOME);
  assert.equal(controls.keyMappings.menu, AndroidKeyCode.MENU);
  assert.equal(controls.keyMappings.info, AndroidKeyCode.INFO);
});

test('default media mappings use Android media commands rather than navigation arrows', () => {
  assert.equal(DEFAULT_KEY_MAPPINGS.rewind, AndroidKeyCode.MEDIA_REWIND);
  assert.equal(DEFAULT_KEY_MAPPINGS.fastForward, AndroidKeyCode.MEDIA_FAST_FORWARD);
  assert.equal(DEFAULT_KEY_MAPPINGS.next, AndroidKeyCode.MEDIA_NEXT);
  assert.equal(DEFAULT_KEY_MAPPINGS.previous, AndroidKeyCode.MEDIA_PREVIOUS);
  assert.equal(DEFAULT_KEY_MAPPINGS.stop, AndroidKeyCode.MEDIA_STOP);
});

test('all supported input types map to their HAP InputSourceType value', () => {
  assert.deepEqual(
    ['other', 'home', 'tuner', 'hdmi', 'composite', 'svideo', 'component', 'dvi', 'airplay', 'usb', 'application']
      .map(type => inputSourceType(type as Parameters<typeof inputSourceType>[0])),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
});
