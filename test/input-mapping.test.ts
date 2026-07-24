import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ActiveInputLearner,
  duplicateExplicitPackages,
  resolveInputIdentifier,
  type InputPackageBinding,
} from '../src/input/input-mapping';
import { InputMappingStore } from '../src/storage/input-mapping-store';

const inputs: InputPackageBinding[] = [
  { identifier: 1, name: 'Explicit', uri: 'explicit://open', packageName: 'com.example.explicit' },
  { identifier: 2, name: 'Learned', uri: 'learned://open', learnedPackageName: 'com.example.learned' },
  { identifier: 3, name: 'Package URI', uri: 'com.example.direct' },
];

test('active input resolution prefers explicit, learned, and package URI mappings', () => {
  assert.equal(resolveInputIdentifier(inputs, 'com.example.explicit'), 1);
  assert.equal(resolveInputIdentifier(inputs, 'com.example.learned'), 2);
  assert.equal(resolveInputIdentifier(inputs, 'com.example.direct'), 3);
  assert.equal(resolveInputIdentifier(inputs, 'com.example.unknown'), 0);
  assert.equal(resolveInputIdentifier(inputs, undefined), 0);
});

test('duplicate explicit package mappings are detected', () => {
  assert.deepEqual(duplicateExplicitPackages([
    { name: 'One', uri: 'one://open', packageName: 'com.example.same' },
    { name: 'Two', uri: 'two://open', packageName: 'com.example.same' },
  ]), ['com.example.same']);
});

test('automatic learning requires a stable unknown package', async () => {
  const keepAlive = setTimeout(() => undefined, 100);
  const learned = new Promise<{ identifier: number; packageName: string }>(resolve => {
    const learner = new ActiveInputLearner(
      (identifier, packageName) => resolve({ identifier, packageName }),
      100,
      15,
    );
    learner.begin(4);
    learner.observe('com.example.first', 0);
    learner.observe('com.example.final', 0);
  });
  try {
    assert.deepEqual(await learned, { identifier: 4, packageName: 'com.example.final' });
  } finally {
    clearTimeout(keepAlive);
  }
});

test('automatic learning stops when the reported package already maps to an input', async () => {
  let learned = false;
  const learner = new ActiveInputLearner(() => { learned = true; }, 40, 5);
  learner.begin(2);
  learner.observe('com.example.known', 1);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(learned, false);
});

test('automatic learning ignores the app that was already open before launch', async () => {
  const keepAlive = setTimeout(() => undefined, 100);
  const learned = new Promise<{ identifier: number; packageName: string }>(resolve => {
    const learner = new ActiveInputLearner(
      (identifier, packageName) => resolve({ identifier, packageName }),
      100,
      10,
    );
    learner.begin(4, 'com.example.previous');
    learner.observe('com.example.previous', 0);
    setTimeout(() => learner.observe('com.example.destination', 0), 5);
  });
  try {
    assert.deepEqual(await learned, { identifier: 4, packageName: 'com.example.destination' });
  } finally {
    clearTimeout(keepAlive);
  }
});

test('learned mappings persist and a package moves between inputs without duplicates', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'atvu-input-mapping-'));
  const store = new InputMappingStore(storage);
  await store.learn('tv', 1, 'com.example.streaming');
  await store.learn('tv', 2, 'com.example.streaming');
  assert.deepEqual((await store.list('tv')).map(item => [item.inputIdentifier, item.packageName]), [
    [2, 'com.example.streaming'],
  ]);
  await store.remove('tv', 2);
  assert.deepEqual(await store.list('tv'), []);
});
