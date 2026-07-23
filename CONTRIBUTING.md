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

Commits and pull requests should be authored under your own name. By contributing, you agree that your work is licensed under the MIT License.
