(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.AndroidTvInputEditor = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const COMMAND_MODES = Object.freeze({
    PACKAGE: 'package',
    DEEP_LINK: 'deep-link',
    KEY_CODE: 'key-code',
  })
  const PACKAGE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/
  const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/

  const clean = value => String(value ?? '').trim()

  function isAndroidPackage(value) {
    return PACKAGE_PATTERN.test(clean(value))
  }

  function hasUriScheme(value) {
    return URI_SCHEME_PATTERN.test(clean(value))
  }

  function classifyCommand(input = {}) {
    if (input.keyCode !== undefined && input.keyCode !== null && input.keyCode !== '') {
      return COMMAND_MODES.KEY_CODE
    }
    const uri = clean(input.uri)
    if (!uri || isAndroidPackage(uri)) return COMMAND_MODES.PACKAGE
    return COMMAND_MODES.DEEP_LINK
  }

  function createCommandDraft(input = {}) {
    const uri = clean(input.uri)
    return {
      mode: classifyCommand(input),
      packageValue: isAndroidPackage(uri) ? uri : '',
      deepLinkValue: uri && !isAndroidPackage(uri) ? uri : '',
      keyCodeValue: input.keyCode === undefined || input.keyCode === null ? '' : String(input.keyCode),
    }
  }

  function serializeCommand(input, draft) {
    const output = { ...input }
    delete output.uri
    delete output.keyCode
    if (draft.mode === COMMAND_MODES.PACKAGE) {
      const value = clean(draft.packageValue)
      if (value) output.uri = value
    } else if (draft.mode === COMMAND_MODES.DEEP_LINK) {
      const value = clean(draft.deepLinkValue)
      if (value) output.uri = value
    } else if (draft.mode === COMMAND_MODES.KEY_CODE) {
      const value = clean(draft.keyCodeValue)
      if (value && Number.isInteger(Number(value))) output.keyCode = Number(value)
    }
    return output
  }

  function draftHasCommandValue(draft) {
    if (draft.mode === COMMAND_MODES.PACKAGE) return Boolean(clean(draft.packageValue))
    if (draft.mode === COMMAND_MODES.DEEP_LINK) return Boolean(clean(draft.deepLinkValue))
    return Boolean(clean(draft.keyCodeValue))
  }

  function validateCommandDraft(draft) {
    if (draft.mode === COMMAND_MODES.PACKAGE) {
      const value = clean(draft.packageValue)
      if (!value) return 'Enter an Android app package.'
      if (!isAndroidPackage(value)) return 'Use a package ID such as com.netflix.ninja.'
      return undefined
    }
    if (draft.mode === COMMAND_MODES.DEEP_LINK) {
      const value = clean(draft.deepLinkValue)
      if (!value) return 'Enter a deep link or URI.'
      if (!hasUriScheme(value)) return 'Start the link with a scheme such as https:, intent:, or my-app:.'
      return undefined
    }
    const value = clean(draft.keyCodeValue)
    if (!value) return 'Enter an Android key code.'
    const keyCode = Number(value)
    if (!Number.isInteger(keyCode) || keyCode < 0 || keyCode > 1000) {
      return 'Use a whole-number Android key code from 0 to 1000.'
    }
    return undefined
  }

  function commandModeLabel(mode) {
    if (mode === COMMAND_MODES.DEEP_LINK) return 'Deep link / URI'
    if (mode === COMMAND_MODES.KEY_CODE) return 'Android key command'
    return 'App package'
  }

  function commandSummary(input = {}) {
    const mode = classifyCommand(input)
    if (mode === COMMAND_MODES.KEY_CODE) return `Android key ${input.keyCode}`
    const value = clean(input.uri)
    return `${commandModeLabel(mode)}${value ? ` · ${value}` : ''}`
  }

  function inputMatchesPreset(input = {}, preset = {}) {
    return clean(input.name) === clean(preset.name)
      && clean(input.type || 'application') === clean(preset.type || 'application')
      && clean(input.uri) === clean(preset.uri)
      && clean(input.packageName) === clean(preset.packageName)
      && (input.keyCode ?? null) === (preset.keyCode ?? null)
  }

  function personalPresetDefinition(input = {}, id) {
    const preset = {
      id: clean(id),
      name: clean(input.name),
      type: clean(input.type) || 'application',
    }
    const uri = clean(input.uri)
    const packageName = clean(input.packageName)
    if (uri) preset.uri = uri
    if (input.keyCode !== undefined && input.keyCode !== null && input.keyCode !== '') {
      preset.keyCode = Number(input.keyCode)
    }
    if (packageName) preset.packageName = packageName
    return preset
  }

  function personalPresetConfig(preset = {}) {
    return {
      customPresetId: preset.id,
      name: preset.name,
      type: preset.type || 'application',
      uri: preset.uri,
      packageName: preset.packageName,
      keyCode: preset.keyCode,
    }
  }

  return {
    COMMAND_MODES,
    classifyCommand,
    commandModeLabel,
    commandSummary,
    createCommandDraft,
    draftHasCommandValue,
    hasUriScheme,
    inputMatchesPreset,
    isAndroidPackage,
    personalPresetConfig,
    personalPresetDefinition,
    serializeCommand,
    validateCommandDraft,
  }
})
