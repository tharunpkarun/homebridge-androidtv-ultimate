# Changelog

All notable changes are documented here.

## 0.5.2 - 2026-07-30

- Add original AndroidTV Ultimate branding in repository and verification-ready icon sizes.
- Declare HAP transport support without installing Homebridge as a plugin dependency.
- Catch and log platform startup failures instead of allowing an unhandled rejection.
- Make tag releases retry-safe and create matching GitHub Releases from changelog notes.

## 0.5.1 - 2026-07-29

- Add per-row testing for unsaved app packages, deep links, and Android key commands, with foreground-package observation and an explicit action to apply a detected package to the editor.
- Add configurable CEC wake through another paired Android device, such as a set-top box, with parallel Wake-on-LAN, adjustable Power-to-Home timing, target confirmation, and optional HomeKit No Response reporting.
- Keep CEC helper activation wake-only, prevent recursive helper chains, and retain the target's confirmed power state until its own Remote Service connection returns.

## 0.5.0 - 2026-07-29

- Replace simultaneous package, deep-link, and key-code fields with a guided command-type editor that classifies existing inputs, validates commands inline, and preserves unsaved alternatives while switching modes.
- Add command summaries to catalog choices without changing the catalog or saved configuration schemas.
- Add an explicit My presets library in plugin configuration for reusing personal inputs across TVs as independent copies, with manual reapply/update controls and encrypted-backup support.

## 0.4.1 - 2026-07-29

- Convert bare Android package IDs to Remote Service v2 market launch links when switching Apple Home inputs, while preserving explicit deep links and catalog package mappings.

## 0.4.0 - 2026-07-28

- Move app and hardware input presets into a versioned, PR-maintained GitHub JSON catalog with strict runtime and CI validation.
- Load cached or bundled presets immediately, refresh GitHub in the background with ETag support, and retain the last valid cache across network or catalog failures.
- Add catalog search, source and refresh status, contribution links, edited-preset indicators, removed-preset warnings, and an explicit restore-defaults action without automatically rewriting saved inputs.

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
