import { ProtoWriter, decodeFields, firstBytes } from './protobuf';

export const PairingField = {
  REQUEST: 10,
  REQUEST_ACK: 11,
  OPTION: 20,
  CONFIGURATION: 30,
  SECRET: 40,
  SECRET_ACK: 41,
} as const;

const PairingRole = { INPUT: 1 } as const;
const PairingEncodingType = { HEXADECIMAL: 3 } as const;

export function encodePairingRequest(serviceName: string, clientName: string): Buffer {
  return new ProtoWriter().message(PairingField.REQUEST, writer => {
    writer.string(1, serviceName).string(2, clientName);
  }).finish();
}

function writeEncoding(writer: ProtoWriter): void {
  writer.varint(1, PairingEncodingType.HEXADECIMAL).varint(2, 6);
}

export function encodePairingOption(): Buffer {
  return new ProtoWriter().message(PairingField.OPTION, writer => {
    writer.varint(1, PairingRole.INPUT).message(2, writeEncoding).message(3, writeEncoding);
  }).finish();
}

export function encodePairingConfiguration(): Buffer {
  return new ProtoWriter().message(PairingField.CONFIGURATION, writer => {
    writer.varint(1, PairingRole.INPUT).message(2, writeEncoding);
  }).finish();
}

export function encodePairingSecret(secret: Buffer): Buffer {
  return new ProtoWriter().message(PairingField.SECRET, writer => writer.bytes(1, secret)).finish();
}

export function pairingMessageType(message: Buffer): number | undefined {
  return decodeFields(message).find(field => Object.values(PairingField).includes(field.number as never))?.number;
}

export function pairingStatus(message: Buffer): number | undefined {
  const status = firstBytes(decodeFields(message), 1);
  if (!status) {
    return undefined;
  }
  const nested = decodeFields(status);
  const value = nested.find(field => field.number === 1 && typeof field.value === 'bigint')?.value;
  return typeof value === 'bigint' ? Number(value) : undefined;
}
