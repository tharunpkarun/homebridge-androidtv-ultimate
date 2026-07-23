# Hardware acceptance checklist

Run this checklist on both Percee TV and Xstream before the first stable release.

- [ ] mDNS discovery finds the correct host and name.
- [ ] A DHCP address change updates the cached endpoint and reconnects without re-pairing.
- [ ] A TV that is offline during discovery remains in the dashboard cache.
- [ ] Fresh pairing displays and accepts a six-character code.
- [ ] Credentials survive Homebridge restart and plugin upgrade.
- [ ] Turning the TV off makes Home show Off after the grace period.
- [ ] Starting Homebridge while the TV is off shows Off immediately.
- [ ] Disconnecting Ethernet/Wi-Fi shows Off and reconnects without restart.
- [ ] Home, Back, arrows, Select, Play/Pause, Info, and Exit work.
- [ ] Volume up/down, absolute volume, and mute work without feedback loops.
- [ ] Sleep and wake commands do not toggle in the wrong direction.
- [ ] Wake-on-LAN works from deep standby where the hardware supports it.
- [ ] App Input Sources launch configured URIs.
- [ ] Two TVs remain isolated while one is offline or reconnecting.
- [ ] Pairing failure, revoked certificate, wrong IP, and blocked ports produce useful diagnostics.
- [ ] Homebridge child bridge mode works.
- [ ] Upgrade from the previous plugin preserves imported TV credentials/config but not Apple Home identity.

Record firmware versions and sanitized diagnostics with each completed run.
