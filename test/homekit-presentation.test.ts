import assert from 'node:assert/strict';
import test from 'node:test';
import { applyHomeKitPresentation, homeKitPresentation } from '../src/homekit/presentation';

const categories = { TELEVISION: 31, TV_SET_TOP_BOX: 35 };

test('HomeKit profile maps to the matching HAP category', () => {
  assert.deepEqual(homeKitPresentation({ deviceType: 'television' }, categories), {
    category: 31,
    standalone: false,
  });
  assert.deepEqual(homeKitPresentation({ deviceType: 'settopbox', exposureMode: 'standalone' }, categories), {
    category: 35,
    standalone: true,
  });
});

test('HomeKit presentation marks Television as the primary service', () => {
  const accessory = { category: 1 };
  let primary = false;
  const television = { setPrimaryService: () => { primary = true; } };

  applyHomeKitPresentation(accessory as never, television as never, { category: 31, standalone: false });

  assert.equal(accessory.category, 31);
  assert.equal(primary, true);
});
