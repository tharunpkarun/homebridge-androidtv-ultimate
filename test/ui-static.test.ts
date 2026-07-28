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
  assert.match(html, /id="atvuCecWakeHelper"/);
  assert.match(html, /id="atvuCecWakeDelay"/);
  assert.match(html, /id="atvuCecWakeTimeout"/);
  assert.match(html, /id="atvuCecWakeFailure"/);
  assert.match(html, /another paired Android device, such as a set-top box/i);
  assert.match(html, /renderCecWakeHelperOptions/);
  assert.match(html, /id="atvuApplyControlDefaults"/);
  assert.match(html, /Android key-code mapping/);
  assert.match(html, /Apple Home input type/);
  assert.match(html, /Android key code/);
  assert.match(html, /id="atvuInputPreset"/);
  assert.match(html, /id="atvuAddInputPreset"/);
  assert.match(html, /id="atvuInputSearch"/);
  assert.match(html, /id="atvuRefreshInputCatalog"/);
  assert.match(html, /Create custom input/);
  assert.match(html, /id="atvuPersonalPresets"/);
  assert.match(html, /Save to My presets/);
  assert.match(html, /Apply saved preset/);
  assert.match(html, /Update My preset/);
  assert.match(html, /Personal preset removed/);
  assert.match(html, /src="input-editor\.js"/);
  assert.match(html, /Command type/);
  assert.match(html, /App package/);
  assert.match(html, /Deep link \/ URI/);
  assert.match(html, /Android key command/);
  assert.match(html, /serializeCommand/);
  assert.match(html, /validateCommandDraft/);
  assert.match(html, /Suggest a preset/);
  assert.match(html, /loadInputCatalog/);
  assert.match(html, /Edited from catalog/);
  assert.match(html, /Restore catalog defaults/);
  assert.match(html, /Preset no longer listed/);
  assert.doesNotMatch(html, /const inputPresets =/);
  for (const profile of ['Streaming Stick', 'Apple TV', 'Audio Receiver', 'Speaker', 'HomePod']) {
    assert.match(html, new RegExp(`>${profile}<`));
  }
  assert.match(html, /if \(discovered && !online\)/);
  assert.match(html, /setInterval\(\(\) => \{ if \(!document\.hidden\) void refresh\(false\) \}, 5000\)/);
  assert.match(html, /visibilitychange/);
  assert.doesNotMatch(html, /window\.prompt/);
});

test('configuration schema supports reusable personal input presets', async () => {
  const schema = JSON.parse(await readFile(path.join(process.cwd(), 'config.schema.json'), 'utf8'));
  const properties = schema.schema?.properties;
  assert.equal(properties?.customInputPresets?.type, 'array');
  assert.ok(properties?.customInputPresets?.items?.properties?.id);
  assert.ok(properties?.devices?.items?.properties?.inputs?.items?.properties?.customPresetId);
});

test('configuration schema supports a CEC wake helper and failure policy', async () => {
  const schema = JSON.parse(await readFile(path.join(process.cwd(), 'config.schema.json'), 'utf8'));
  const cecWake = schema.schema?.properties?.devices?.items?.properties?.cecWake;
  assert.equal(cecWake?.type, 'object');
  assert.ok(cecWake?.properties?.helperDeviceId);
  assert.equal(cecWake?.properties?.powerToHomeDelayMs?.default, 1500);
  assert.equal(cecWake?.properties?.confirmationTimeoutSeconds?.default, 30);
  assert.equal(cecWake?.properties?.failureBehavior?.default, 'remainOff');
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

test('guided input editor helper has valid JavaScript syntax', async () => {
  const script = await readFile(path.join(process.cwd(), 'homebridge-ui', 'public', 'input-editor.js'), 'utf8');
  assert.doesNotThrow(() => new Function(script));
});
