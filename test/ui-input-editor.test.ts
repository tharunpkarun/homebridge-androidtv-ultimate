import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

type CommandMode = 'package' | 'deep-link' | 'key-code';

interface CommandDraft {
  mode: CommandMode;
  packageValue: string;
  deepLinkValue: string;
  keyCodeValue: string;
}

interface InputEditorHelpers {
  COMMAND_MODES: { PACKAGE: CommandMode; DEEP_LINK: CommandMode; KEY_CODE: CommandMode };
  classifyCommand(input: Record<string, unknown>): CommandMode;
  commandSummary(input: Record<string, unknown>): string;
  createCommandDraft(input: Record<string, unknown>): CommandDraft;
  draftHasCommandValue(draft: CommandDraft): boolean;
  inputMatchesPreset(input: Record<string, unknown>, preset: Record<string, unknown>): boolean;
  personalPresetConfig(preset: Record<string, unknown>): Record<string, unknown>;
  personalPresetDefinition(input: Record<string, unknown>, id: string): Record<string, unknown>;
  serializeCommand(input: Record<string, unknown>, draft: CommandDraft): Record<string, unknown>;
  validateCommandDraft(draft: CommandDraft): string | undefined;
}

async function inputEditorHelpers(): Promise<InputEditorHelpers> {
  const source = await readFile(path.join(process.cwd(), 'homebridge-ui', 'public', 'input-editor.js'), 'utf8');
  const sandbox: { AndroidTvInputEditor?: InputEditorHelpers } = {};
  runInNewContext(source, sandbox);
  assert.ok(sandbox.AndroidTvInputEditor);
  return sandbox.AndroidTvInputEditor;
}

test('guided input editor classifies existing and catalog commands', async () => {
  const helpers = await inputEditorHelpers();
  assert.equal(helpers.classifyCommand({ uri: 'com.netflix.ninja' }), helpers.COMMAND_MODES.PACKAGE);
  assert.equal(helpers.classifyCommand({ uri: 'intent://watch#Intent;end' }), helpers.COMMAND_MODES.DEEP_LINK);
  assert.equal(helpers.classifyCommand({ uri: 'example-app://browse' }), helpers.COMMAND_MODES.DEEP_LINK);
  assert.equal(helpers.classifyCommand({ uri: 'com.netflix.ninja', keyCode: 243 }), helpers.COMMAND_MODES.KEY_CODE);
  assert.equal(helpers.classifyCommand({}), helpers.COMMAND_MODES.PACKAGE);
  assert.equal(helpers.commandSummary({ uri: 'com.netflix.ninja' }), 'App package · com.netflix.ninja');
  assert.equal(helpers.commandSummary({ keyCode: 243 }), 'Android key 243');
});

test('guided input editor preserves draft alternatives but serializes only the selected command', async () => {
  const helpers = await inputEditorHelpers();
  const original = { name: 'Netflix', type: 'application', uri: 'com.netflix.ninja', keyCode: 243 };
  const draft = helpers.createCommandDraft(original);
  assert.equal(draft.mode, helpers.COMMAND_MODES.KEY_CODE);
  assert.equal(draft.packageValue, 'com.netflix.ninja');
  assert.equal(draft.keyCodeValue, '243');

  draft.mode = helpers.COMMAND_MODES.DEEP_LINK;
  draft.deepLinkValue = 'netflix://browse';
  const deepLink = helpers.serializeCommand(original, draft);
  assert.equal(deepLink.uri, 'netflix://browse');
  assert.equal(deepLink.keyCode, undefined);
  assert.equal(deepLink.mode, undefined);
  assert.equal(deepLink.packageValue, undefined);

  draft.mode = helpers.COMMAND_MODES.PACKAGE;
  const restoredPackage = helpers.serializeCommand(deepLink, draft);
  assert.equal(restoredPackage.uri, 'com.netflix.ninja');
  assert.equal(restoredPackage.keyCode, undefined);
});

test('guided input editor validates the selected command type', async () => {
  const helpers = await inputEditorHelpers();
  const packageDraft = helpers.createCommandDraft({ uri: 'not a package' });
  packageDraft.mode = helpers.COMMAND_MODES.PACKAGE;
  packageDraft.packageValue = 'not a package';
  assert.match(helpers.validateCommandDraft(packageDraft) ?? '', /package ID/);
  packageDraft.packageValue = 'com.example.tv';
  assert.equal(helpers.validateCommandDraft(packageDraft), undefined);

  packageDraft.mode = helpers.COMMAND_MODES.DEEP_LINK;
  packageDraft.deepLinkValue = 'example.com/watch';
  assert.match(helpers.validateCommandDraft(packageDraft) ?? '', /scheme/);
  packageDraft.deepLinkValue = 'https://example.com/watch';
  assert.equal(helpers.validateCommandDraft(packageDraft), undefined);

  packageDraft.mode = helpers.COMMAND_MODES.KEY_CODE;
  packageDraft.keyCodeValue = '1001';
  assert.match(helpers.validateCommandDraft(packageDraft) ?? '', /0 to 1000/);
  packageDraft.keyCodeValue = '243';
  assert.equal(helpers.validateCommandDraft(packageDraft), undefined);
  assert.equal(helpers.draftHasCommandValue(packageDraft), true);
});

test('personal presets omit device identity and create independent input copies', async () => {
  const helpers = await inputEditorHelpers();
  const preset = helpers.personalPresetDefinition({
    name: '  Prime Video  ',
    type: 'application',
    uri: '  com.amazon.amazonvideo.livingroom  ',
    packageName: ' com.amazon.amazonvideo.livingroom ',
    identifier: 7,
    presetId: 'prime-video',
    customPresetId: 'old-personal-preset',
  }, 'personal-prime-video');
  assert.deepEqual(JSON.parse(JSON.stringify(preset)), {
    id: 'personal-prime-video',
    name: 'Prime Video',
    type: 'application',
    uri: 'com.amazon.amazonvideo.livingroom',
    packageName: 'com.amazon.amazonvideo.livingroom',
  });
  const configured = helpers.personalPresetConfig(preset);
  assert.equal(configured.customPresetId, 'personal-prime-video');
  assert.equal(configured.identifier, undefined);
  assert.equal(configured.presetId, undefined);
  assert.equal(helpers.inputMatchesPreset(configured, preset), true);
  configured.name = 'Prime Video Bedroom';
  assert.equal(preset.name, 'Prime Video');
  assert.equal(helpers.inputMatchesPreset(configured, preset), false);
});
