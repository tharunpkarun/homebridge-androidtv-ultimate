# Changelog

All notable changes are documented here.

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
