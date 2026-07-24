# Changelog

All notable changes are documented here.

## 0.2.0 - 2026-07-24

- Rebuilt the custom settings UI with Dashboard, Devices, Settings, and Tools & Support tabs.
- Added rich device cards with explicit TV names, manufacturer/model, pairing and live state, network/discovery identity, first/last seen times, Wake-on-LAN readiness, app inputs, and connection-test results.
- Added automatic, light, and dark themes with responsive layouts.
- Replaced prompt-based manual setup with a complete TV and app-input editor.
- Added package/runtime details, structured GitHub bug reporting, and privacy-safe diagnostics with identifiers redacted by default.
- Added passphrase-protected AES-256-GCM backup and restore for plugin configuration, pairing credentials, discovery cache, and last-known state.

## 0.1.1 - 2026-07-24

- Persistent mDNS endpoint cache with automatic IP refresh and live transport reconnection.
- Stable matching by Android TXT/hardware ID, MAC, service name, hostname, and prior endpoint.
- Cached offline devices remain available in the pairing dashboard.
- IPv4 is preferred over unusable link-local IPv6 addresses when both are advertised.
- Unrelated Matter and other mDNS services are excluded from Android TV discovery.

## 0.1.0 - 2026-07-23

- Initial Remote Service v2 pairing and mutually authenticated transport.
- Dynamic Homebridge Television platform with per-device state isolation.
- Accurate offline power state and reconnect grace period.
- Remote keys, volume, mute, app links, and optional Wake-on-LAN.
- Custom discovery, pairing, migration, status, test, and diagnostics UI.
- Legacy configuration preview/import without Apple Home identity data.
