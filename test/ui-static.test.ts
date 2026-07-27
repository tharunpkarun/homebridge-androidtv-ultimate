import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

async function customUi(): Promise<string> {
  return readFile(path.join(process.cwd(), 'homebridge-ui', 'public', 'index.html'), 'utf8');
}

test('custom UI exposes rich tabs, identity labels, themes, support, and backup controls', async () => {
  const html = await customUi();
  for (const tab of ['dashboard', 'devices', 'settings', 'tools']) {
    assert.match(html, new RegExp(`data-atvu-tab="${tab}"`));
    assert.match(html, new RegExp(`data-atvu-panel="${tab}"`));
  }
  assert.match(html, /Device name/);
  assert.match(html, /data-theme="dark"/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /id="atvuPackageButton"/);
  assert.match(html, /id="atvuBugButton"/);
  assert.match(html, /id="atvuExportBackup"/);
  assert.match(html, /id="atvuImportBackup"/);
  assert.match(html, /Android package \(optional\)/);
  assert.match(html, /Clear detected package/);
  assert.match(html, /id="atvuEditExposure"/);
  assert.match(html, /Standalone accessory \(exact profile glyph\)/);
  for (const control of ['Power', 'Remote', 'Media', 'Volume', 'Mute', 'Inputs', 'WakeOnLan']) {
    assert.match(html, new RegExp(`id="atvuControl${control}"`));
  }
  assert.match(html, /id="atvuApplyControlDefaults"/);
  assert.match(html, /Android key-code mapping/);
  assert.match(html, /Apple Home input type/);
  assert.match(html, /Android key code/);
  for (const profile of ['Streaming Stick', 'Apple TV', 'Audio Receiver', 'Speaker', 'HomePod']) {
    assert.match(html, new RegExp(`>${profile}<`));
  }
  assert.match(html, /if \(discovered && !online\)/);
  assert.match(html, /setInterval\(\(\) => \{ if \(!document\.hidden\) void refresh\(false\) \}, 5000\)/);
  assert.match(html, /visibilitychange/);
  assert.doesNotMatch(html, /window\.prompt/);
});

test('custom UI element IDs are unique', async () => {
  const html = await customUi();
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('custom UI inline script has valid JavaScript syntax', async () => {
  const html = await customUi();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 1);
  const script = scripts[0];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
