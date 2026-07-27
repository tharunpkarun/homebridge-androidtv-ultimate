import assert from 'node:assert/strict';
import test from 'node:test';
import { applyHomeKitPresentation, homeKitPresentation } from '../src/homekit/presentation';

const categories = {
  TELEVISION: 31,
  TV_SET_TOP_BOX: 35,
  TV_STREAMING_STICK: 36,
  APPLE_TV: 24,
  AUDIO_RECEIVER: 34,
  SPEAKER: 26,
  HOMEPOD: 25,
};

test('HomeKit profile maps to the matching HAP category', () => {
  assert.deepEqual(homeKitPresentation({ deviceType: 'television' }, categories), {
    category: 31,
    standalone: false,
  });
  assert.deepEqual(homeKitPresentation({ deviceType: 'settopbox', exposureMode: 'standalone' }, categories), {
    category: 35,
    standalone: true,
  });
  assert.equal(homeKitPresentation({ deviceType: 'streamingstick' }, categories).category, 36);
  assert.equal(homeKitPresentation({ deviceType: 'appletv' }, categories).category, 24);
  assert.equal(homeKitPresentation({ deviceType: 'audioreceiver' }, categories).category, 34);
  assert.equal(homeKitPresentation({ deviceType: 'speaker' }, categories).category, 26);
  assert.equal(homeKitPresentation({ deviceType: 'homepod' }, categories).category, 25);
});

test('HomeKit presentation marks Television as the primary service', () => {
  const accessory = { category: 1 };
  let primary = false;
  const television = { setPrimaryService: () => { primary = true; } };

  applyHomeKitPresentation(accessory as never, television as never, { category: 31, standalone: false });

  assert.equal(accessory.category, 31);
  assert.equal(primary, true);
});
