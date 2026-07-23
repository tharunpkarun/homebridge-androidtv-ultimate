import assert from 'node:assert/strict';
import test from 'node:test';
import { recordsToDevices, type DnsRecord } from '../src/network/discovery';

test('mDNS results exclude unrelated SRV services and prefer IPv4', () => {
  const androidInstance = 'Xstream._androidtvremote2._tcp.local';
  const androidHost = 'Android_device.local';
  const records: DnsRecord[] = [
    { name: '_androidtvremote2._tcp.local', type: 12, data: androidInstance },
    { name: androidInstance, type: 33, data: { port: 6466, target: androidHost } },
    { name: androidInstance, type: 16, data: { bt: '44:F5:3E:0C:41:7A' } },
    { name: androidHost, type: 28, data: 'fe80:0:0:0:1:2:3:4' },
    { name: androidHost, type: 1, data: '10.1.10.115' },
    { name: 'Bridge._matterc._udp.local', type: 33, data: { port: 5530, target: 'bridge.local' } },
    { name: 'bridge.local', type: 1, data: '10.1.10.105' },
  ];

  const devices = recordsToDevices(records);
  assert.equal(devices.length, 1);
  assert.equal(devices[0]?.name, 'Xstream');
  assert.equal(devices[0]?.host, '10.1.10.115');
  assert.equal(devices[0]?.discoveryId, '44:F5:3E:0C:41:7A');
});
