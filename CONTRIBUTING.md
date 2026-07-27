# Contributing

Thank you for helping improve AndroidTV Ultimate.

## Development

Use Node.js 20, 22, or 24:

```bash
npm install
npm run check
npm run build
```

Keep protocol codecs independent from Homebridge. New wire messages belong under `src/protocol`, device behavior belongs in the transport/state machine, and HomeKit mapping belongs in `src/accessory`.

## Pull requests

- Open an issue first for protocol or accessory topology changes.
- Add tests for framing, state transitions, and message field numbers.
- Do not commit TV certificates, pairing codes, Homebridge config files, logs containing private data, or packet captures with unreviewed payloads.
- Keep ADB, cloud services, and telemetry out of the Remote Service v2 transport.
- Confirm `npm run check` and `npm run build` pass.

Hardware-specific fixes should include the manufacturer, model, Android TV version, Remote Service package version if known, and sanitized dashboard diagnostics.

## Input catalog contributions

The official input presets live in [`catalog/input-presets.json`](catalog/input-presets.json). The plugin reads the merged file from GitHub when its input editor opens, so additions and corrections become available without waiting for another npm release.

To add or update a preset:

1. Edit `catalog/input-presets.json` and update its `updatedAt` date.
2. Keep `id` stable, unique, lowercase, and hyphen-separated. Do not change an existing ID when correcting its values.
3. Use an existing group where possible and keep entries alphabetical inside each contiguous group.
4. Provide exactly one command: `uri` for an Android package/deep link or `keyCode` for an Android key event. `packageName` is optional active-input feedback for deep links.
5. Verify app packages from the installed Android TV app or a foreground-package report. Document device-specific key commands in the pull request.
6. Run `npm run check`, `npm run build`, and `npm run validate:catalog`.

Example:

```json
{
  "id": "example-streaming",
  "group": "Streaming apps",
  "name": "Example Streaming",
  "type": "application",
  "uri": "com.example.androidtv"
}
```

Catalog pull requests are rejected when they contain unknown fields, duplicate IDs, unsupported HomeKit input types, invalid key codes, missing commands, or an incompatible schema version.

Commits and pull requests should be authored under your own name. By contributing, you agree that your work is licensed under the MIT License.
