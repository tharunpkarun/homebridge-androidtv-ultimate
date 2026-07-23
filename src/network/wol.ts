import dgram from 'node:dgram';

export function createMagicPacket(mac: string): Buffer {
  const normalized = mac.replace(/[:-]/g, '');
  if (!/^[0-9a-fA-F]{12}$/.test(normalized)) {
    throw new Error(`Invalid Wake-on-LAN MAC address: ${mac}`);
  }
  const address = Buffer.from(normalized, 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => address)]);
}

export async function wakeOnLan(mac: string, broadcastAddress = '255.255.255.255', port = 9): Promise<void> {
  const packet = createMagicPacket(mac);
  const socket = dgram.createSocket('udp4');
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, () => {
        socket.setBroadcast(true);
        let sent = 0;
        const send = (): void => {
          socket.send(packet, port, broadcastAddress, error => {
            if (error) {
              reject(error);
              return;
            }
            sent += 1;
            if (sent === 3) {
              resolve();
            } else {
              setTimeout(send, 75);
            }
          });
        };
        send();
      });
    });
  } finally {
    socket.close();
  }
}
