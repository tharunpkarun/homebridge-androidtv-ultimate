# Changelog

All notable changes are documented here.

## Unreleased

- Add a categorized input-preset dropdown for popular Android TV apps, Home, tuner, HDMI, analog sources, input selection, and USB while retaining fully editable custom inputs.

## 0.3.5 - 2026-07-28

- Mark the Television service as primary so bridged TVs no longer use the generic house glyph in Apple Home.
- Apply the configured Television or Set-top Box HAP category and add an opt-in standalone exposure mode for exact profile glyphs.
- Preserve bridged exposure by default and document the Apple Home re-pairing implications when switching an existing TV to standalone.
- Add per-device Streaming Stick, Apple TV, Audio Receiver, Speaker, and HomePod presentation profiles.
- Use Television, Speaker, or Smart Speaker as the profile-appropriate primary HomeKit service.
- Add per-device Power, navigation, media, volume, mute, input, and Wake-on-LAN switches to the custom UI and configuration schema.
- Add editable Android key-code mappings for every navigation and media command.
- Expand inputs with HomeKit source types, stable identifiers, Android packages/deep links, active-package matching, and custom key commands.
- Correct the Remote Service v2 server-led Configure, SetActive, and Start handshake so paired TVs accept outbound commands.
- Use the canonical Start and volume field numbers, correct Configure field types, and protocol-compliant ping replies.
- Wait for RemoteStart readiness across brief reconnects before sending HomeKit commands instead of failing inside the disconnect grace window.
- Send portable Android power, volume-step, and mute key events and normalize the TV-reported volume range for HomeKit.

## 0.3.4 - 2026-07-27

- Corrected the Remote Service v2 pairing envelope, option/configuration field numbers, and configuration acknowledgement handling for TVs that ignored malformed pairing negotiations.
- Added pairing state transitions and failures to the Homebridge log for actionable diagnostics.
- Build the runtime automatically when installing a development commit directly from GitHub.
- Hash the raw TLS RSA modulus and exponent bytes when validating the TV code, without adding sign-padding bytes that made correct codes fail.
- Emit and log pairing-code validation failures instead of returning them only to the settings dialog.
- Prefer the authenticated Remote Service connection over stale mDNS cache age in device-health badges.
- Refresh visible device health every five seconds and immediately when the settings page becomes visible again.

## 0.3.3 - 2026-07-26

- Fixed Remote Service v2 pairing for televisions whose advertised names contain Unicode characters, including non-Latin scripts, emoji, and smart punctuation.
- Encoded generated X.509 client certificate names as UTF8String to prevent OpenSSL `bad base64 decode` and `ASN1 too long` errors on Node.js 24.
- Added regression coverage for multilingual and emoji television names across certificate, private-key, and TLS context parsing.

## 0.3.2 - 2026-07-24

- Replaced the remaining Mermaid Quick Start flow with a portable static diagram so every README visual renders on npm.

## 0.3.1 - 2026-07-24

- Replaced the Mermaid discovery flowchart with a portable static diagram that renders on both npm and GitHub.

## 0.3.0 - 2026-07-24

- Added TV-confirmed active app synchronization for Apple Home Television inputs.
- Added explicit Android package mappings and stable automatic package learning for deep-link inputs.
- Added private learned-mapping storage, dashboard inspection/reset controls, encrypted-backup support, and privacy-safe diagnostics.

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
