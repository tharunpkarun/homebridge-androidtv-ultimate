# AndroidTV Ultimate for Homebridge

AndroidTV Ultimate is a local-first Homebridge platform for Android TV and Google TV. It uses Android's Remote Service v2 protocol directly: TLS pairing on port 6467 and a mutually authenticated remote connection on port 6466.

The plugin creates one cached HomeKit Television accessory per configured TV, with a Television Speaker and optional app Input Sources. Every TV has its own connection, state machine, credentials, and reconnect loop, so one offline device cannot alter another TV's state.

## Why this plugin exists

An unreachable TV must not appear as **On**. AndroidTV Ultimate starts at `Off`, changes to `On` only after a successful remote connection, and returns to `Off` after the configurable disconnect grace period. It does not reuse a stale power value from another accessory or a previous process.

## Features

- Android TV Remote Service v2 pairing without ADB
- HomeKit Television remote keys, power, volume, mute, and app URI launch
- mDNS discovery plus manual host configuration
- Persistent discovery cache that follows DHCP/IP changes by Android TXT/hardware ID, MAC, service name, or hostname
- Encrypted TLS credentials stored outside `config.json` with mode `0600`
- Optional Wake-on-LAN only when an offline TV is turned on
- App URI/package entries exposed as HomeKit Input Sources
- Full Homebridge custom UI for discovery, pairing, status, tests, migration, and safe diagnostics
- Explicit migration preview for legacy `androidtv-config.json`
- Compatible with Homebridge 1.8/2.x and Node.js 20, 22, and 24
- No cloud account, analytics, ADB, or telemetry

## Install

Once published:

```bash
npm install -g homebridge-androidtv-ultimate
```

For development:

```bash
git clone https://github.com/tharunpkarun/homebridge-androidtv-ultimate.git
cd homebridge-androidtv-ultimate
npm install
npm run check
npm run build
npm link
```

Open Homebridge, add **AndroidTV Ultimate**, then use its settings dashboard to discover and pair each TV. Restart Homebridge after adding or pairing a device.

Discovered endpoints are cached under `androidtv-ultimate/discovery.json`. The plugin refreshes `_androidtvremote2._tcp.local` every 60 seconds by default. If a paired TV receives a different DHCP address, its live transport switches to the new address and reconnects without changing its HomeKit identity or pairing credentials. Offline TVs remain in the cache and reappear in the dashboard until they advertise again.

## Pairing

1. Make sure the TV and Homebridge are on the same LAN and TCP ports 6466/6467 are not blocked.
2. In the plugin settings, select **Scan Network** or **Add Manually**.
3. Select **Pair**. The TV displays a six-character hexadecimal code.
4. Enter that code in the dashboard and complete pairing.
5. Restart Homebridge. The Television accessory appears in Apple Home.

Pairing creates a unique client certificate for that TV. Private keys are stored in Homebridge's storage directory at `androidtv-ultimate/credentials.json`, never in the platform configuration or UI diagnostics.

## App inputs

Remote Service v2 can launch Android app links but does not provide a portable installed-app catalogue on every firmware. Add known package names or Android TV URIs as `inputs` in the device configuration. Examples:

```json
{
  "name": "YouTube",
  "uri": "https://www.youtube.com/tv"
}
```

```json
{
  "name": "Netflix",
  "uri": "netflix://"
}
```

Input enumeration and voice transport are intentionally deferred until they can be implemented consistently across tested firmware.

## Wake-on-LAN

When the remote connection is online, power commands use Android key events. When it is offline, an `On` request sends Wake-on-LAN only if the device has a configured MAC address. The accessory stays `Off` until the authenticated remote connection returns.

Some TVs disable Wi-Fi/Ethernet in deep standby. Enable network standby or quick start on the TV if Wake-on-LAN is unreliable.

## Legacy migration

The dashboard checks `<Homebridge storage>/androidtv-config.json` (normally `/var/lib/homebridge/androidtv-config.json`). Preview is read-only. Applying migration imports recognizable TV settings and Remote Service v2 certificate/key pairs. It deliberately excludes HomeKit usernames, PINs, bridge identity, and cached Apple Home accessories.

Keep a backup and confirm the preview before applying it. The old file is not deleted.

## Troubleshooting

- **TV is Off in reality but Home says On:** confirm the status dashboard says `offline`; lower `disconnectGraceMs` if desired. The default is 2500 ms.
- **Pairing does not start:** verify the TV is awake and port 6467 is reachable from the Homebridge host/container.
- **Paired but connection test fails:** verify port 6466, the configured host, and that the TV has not revoked the client.
- **Power-on fails while offline:** configure the TV's MAC and broadcast address, then enable network standby on the TV.
- **Docker:** Homebridge generally needs host networking for mDNS discovery and LAN broadcast. Manual host configuration still works when multicast is unavailable.

Generate diagnostics from the plugin dashboard before opening an issue. They contain status and runtime metadata, but no certificates or private keys.

## Supported scope

The v1 target is Android TV/Google TV devices that expose Remote Service v2, including acceptance testing on Percee TV and Xstream hardware. Fire TV, ADB control, cloud APIs, voice streaming, and Remote Service v1 are not part of the first stable release.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and include the diagnostics bundle plus the TV model/firmware for protocol reports.

## License

MIT © 2026 Tharun P Karun
