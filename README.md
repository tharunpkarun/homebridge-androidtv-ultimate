# AndroidTV Ultimate for Homebridge

[![npm version](https://img.shields.io/npm/v/homebridge-androidtv-ultimate.svg)](https://www.npmjs.com/package/homebridge-androidtv-ultimate)
[![CI](https://github.com/tharunpkarun/homebridge-androidtv-ultimate/actions/workflows/ci.yml/badge.svg)](https://github.com/tharunpkarun/homebridge-androidtv-ultimate/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/homebridge-androidtv-ultimate.svg)](LICENSE)

AndroidTV Ultimate is a local-first Homebridge platform for Android TV and Google TV devices. It communicates directly with Android's Remote Service v2 using TLS pairing on port `6467` and a mutually authenticated remote connection on port `6466`.

No ADB server, cloud account, vendor API, analytics, or telemetry is required.

## Highlights

- HomeKit Television, Television Speaker, and app Input Source services
- Power, navigation, Home, Back, playback, volume, mute, and app-link commands
- Remote Service v2 certificate pairing through the Homebridge settings UI
- Automatic `_androidtvremote2._tcp.local` mDNS discovery
- Persistent endpoint cache that follows DHCP/IP address changes
- Stable matching by Android TXT/hardware ID, network MAC, service name, hostname, and previous endpoint
- Independent connection and state machine for every configured device
- Correct offline behavior: an unreachable device does not default to `On`
- Optional Wake-on-LAN for turning on an offline device
- Migration preview for compatible legacy `androidtv-config.json` data
- Safe diagnostics that exclude certificates and private keys
- Homebridge 1.8 and 2.x support on Node.js 20, 22, and 24

## Installation

Install AndroidTV Ultimate from the Homebridge UI by searching for:

```text
homebridge-androidtv-ultimate
```

Or install it from npm:

```bash
npm install -g homebridge-androidtv-ultimate
```

Add the **AndroidTV Ultimate** platform in Homebridge, then open its settings dashboard.

## Quick start

1. Place Homebridge and the Android TV device on the same local network.
2. Open the AndroidTV Ultimate settings dashboard.
3. Select **Scan Network**.
4. Choose a discovered device and select **Pair**.
5. Enter the six-character hexadecimal code displayed by the TV.
6. Save the configuration and restart Homebridge.

The paired device appears in Apple Home as a Television accessory. AndroidTV Ultimate uses cached platform accessories under the main Homebridge bridge or its configured child bridge; it does not publish a separate external bridge for every TV.

## Discovery and automatic IP updates

AndroidTV Ultimate queries `_androidtvremote2._tcp.local` over mDNS. It reads the service instance, hostname, TXT metadata, port, IPv4 address, and IPv6 address advertised by each compatible device.

Discovery results are stored in:

```text
<Homebridge storage>/androidtv-ultimate/discovery.json
```

The default refresh interval is 60 seconds and can be changed with `discoveryIntervalSeconds`.

When an address changes, the plugin:

1. Matches the advertisement to the existing device identity.
2. Updates the cached host and Remote Service port.
3. Closes the stale connection.
4. Reconnects to the new endpoint with the existing pairing certificate.

HomeKit identity and Android TV pairing credentials do not change. Previously discovered devices remain cached while powered off and reappear when they advertise again. New devices are shown in the pairing dashboard, but they are not added to Apple Home until pairing is completed.

IPv4 is preferred when both IPv4 and link-local IPv6 addresses are advertised. The Android `bt` TXT value may be used as a stable discovery identifier, but it is not treated as a Wake-on-LAN network MAC address.

For Docker installations, host networking is recommended because multicast discovery and Wake-on-LAN broadcasts may not cross a bridged container network. Manual host configuration remains available when mDNS is unavailable.

## Power-state behavior

Each device starts with this state:

```text
connection: offline
power: off
```

The accessory changes to `On` only after the authenticated Remote Service connection succeeds. After a disconnect, it returns to `Off` when the configured grace period expires. A short grace period prevents brief Wi-Fi interruptions from causing unnecessary HomeKit state changes.

The default `disconnectGraceMs` value is `2500` milliseconds.

## Pairing and credential storage

Pairing creates a separate client certificate and private key for each device. Credentials are stored outside `config.json` in:

```text
<Homebridge storage>/androidtv-ultimate/credentials.json
```

The file is written with owner-only permissions (`0600`). Certificates, private keys, and pairing codes are excluded from dashboard diagnostics.

If a device revokes its client certificate or is factory-reset, use **Re-pair** in the dashboard.

## HomeKit controls

Depending on device and firmware support, AndroidTV Ultimate provides:

- Active power state
- Directional navigation and Select
- Home, Back, Exit, Menu, and Information keys
- Play/Pause and media navigation
- Volume up/down, absolute volume, and mute
- App URI launch through Input Sources

Every configured TV has its own transport and reconnect loop. A disconnected device cannot overwrite the state of another device.

## App inputs

Remote Service v2 can launch Android app links, but it does not expose a consistent installed-app catalogue on every firmware. App inputs are therefore configured explicitly.

Example web app link:

```json
{
  "name": "Video",
  "uri": "https://example.com/tv"
}
```

Example custom URI:

```json
{
  "name": "Streaming App",
  "uri": "example-app://"
}
```

Configured entries appear as HomeKit Television Input Sources.

## Wake-on-LAN

When a device is online, power commands are sent through Remote Service v2. When it is offline, an `On` request sends a Wake-on-LAN magic packet only if a network MAC address is configured.

The HomeKit accessory remains `Off` until the authenticated remote connection returns. This avoids reporting a successful wake before the device is actually reachable.

Wake-on-LAN depends on hardware and firmware support. Enable network standby, quick start, or the equivalent setting on the TV. Some devices disable their network interface during deep standby and cannot be awakened remotely.

## Configuration reference

The settings dashboard manages the configuration automatically. A simplified platform entry looks like this:

```json
{
  "platform": "AndroidTVUltimate",
  "name": "AndroidTV Ultimate",
  "disconnectGraceMs": 2500,
  "discoveryIntervalSeconds": 60,
  "devices": [
    {
      "id": "stable-device-id",
      "name": "Living Room TV",
      "host": "192.168.1.40",
      "remotePort": 6466,
      "pairingPort": 6467,
      "deviceType": "television",
      "mac": "AA:BB:CC:DD:EE:FF",
      "broadcastAddress": "192.168.1.255",
      "inputs": []
    }
  ]
}
```

| Option | Default | Description |
| --- | ---: | --- |
| `disconnectGraceMs` | `2500` | Delay before a disconnected device is reported as Off |
| `discoveryIntervalSeconds` | `60` | Interval for refreshing cached mDNS endpoints |
| `remotePort` | `6466` | Android TV Remote Service v2 control port |
| `pairingPort` | `6467` | Android TV Remote Service v2 pairing port |
| `mac` | — | Optional network MAC used for identity matching and Wake-on-LAN |
| `broadcastAddress` | `255.255.255.255` | Wake-on-LAN broadcast destination |
| `deviceType` | `television` | HomeKit category: `television` or `settopbox` |

Fields such as `discoveryId`, `serviceName`, and `hostname` are maintained by the discovery dashboard and should normally not be edited manually.

## Legacy migration

The dashboard can preview a legacy configuration at:

```text
<Homebridge storage>/androidtv-config.json
```

On common Docker installations this is `/var/lib/homebridge/androidtv-config.json`.

Applying migration imports recognized device settings and reusable Remote Service v2 certificate/key pairs. It deliberately does not import Apple Home usernames, setup PINs, bridge identities, or cached HomeKit accessories. The original file is not deleted.

## Troubleshooting

### Discovery finds no devices

- Confirm the device is awake and Remote Service v2 is enabled by its firmware.
- Confirm Homebridge and the TV are on the same VLAN/subnet.
- Allow UDP multicast traffic to `224.0.0.251:5353`.
- With Docker, use host networking or add the device manually.

### Pairing does not start

- Confirm TCP port `6467` is reachable from the Homebridge host.
- Keep the TV awake and leave its pairing code visible.
- Cancel the old session and start a fresh pairing attempt.

### A paired device remains offline

- Confirm TCP port `6466` is reachable.
- Select **Scan Network** to refresh the endpoint cache immediately.
- Check the dashboard for the last discovered IP and timestamp.
- Re-pair if the device was reset or pairing clients were cleared.

### The TV is off but Apple Home shows it as on

- Confirm the plugin status is `offline` after the grace period.
- Lower `disconnectGraceMs` if faster offline reporting is preferred.
- Confirm only AndroidTV Ultimate controls that Television accessory.

### Wake-on-LAN does not work

- Verify that `mac` is the Ethernet/Wi-Fi network MAC, not a Bluetooth identifier.
- Set the correct subnet broadcast address when global broadcast is blocked.
- Enable network standby or quick start on the TV.

Generate diagnostics from the dashboard before opening an issue. Diagnostics include connection and discovery status but exclude pairing credentials.

## Supported scope

AndroidTV Ultimate targets Android TV and Google TV devices that expose Remote Service v2.

The initial release does not include:

- Fire TV support
- ADB control
- Vendor cloud APIs
- Voice streaming
- Automatic installed-app enumeration
- Remote Service v1

## Development

```bash
git clone https://github.com/tharunpkarun/homebridge-androidtv-ultimate.git
cd homebridge-androidtv-ultimate
npm install
npm run check
npm run build
npm pack --dry-run
```

Tests cover protobuf framing, pairing messages, remote messages, state isolation, Wake-on-LAN, migration, mDNS filtering, persistent discovery, offline cache retention, and DHCP/IP changes.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. Protocol reports should include the device manufacturer, model, firmware version, and sanitized dashboard diagnostics.

Never attach pairing certificates, private keys, pairing codes, Homebridge backups, or unsanitized packet captures to a public issue.

## License

MIT © 2026 Tharun P Karun
