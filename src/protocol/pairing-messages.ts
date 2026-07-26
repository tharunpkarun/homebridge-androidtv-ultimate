import { ProtoWriter, decodeFields, firstNumber } from './protobuf';

export const PairingField = {
  REQUEST: 10,
  REQUEST_ACK: 11,
  OPTION: 20,
  CONFIGURATION: 30,
  CONFIGURATION_ACK: 31,
  SECRET: 40,
  SECRET_ACK: 41,
} as const;

const PairingRole = { INPUT: 1 } as const;
const PairingEncodingType = { HEXADECIMAL: 3 } as const;
const PROTOCOL_VERSION = 2;
const STATUS_OK = 200;

function envelope(field: number, callback: (writer: ProtoWriter) => void): Buffer {
  return new ProtoWriter()
    .varint(1, PROTOCOL_VERSION)
    .varint(2, STATUS_OK)
    .message(field, callback)
    .finish();
}

export function encodePairingRequest(serviceName: string, clientName: string): Buffer {
  return envelope(PairingField.REQUEST, writer => {
    writer.string(1, serviceName).string(2, clientName);
  });
}

function writeEncoding(writer: ProtoWriter): void {
  writer.varint(1, PairingEncodingType.HEXADECIMAL).varint(2, 6);
}

export function encodePairingOption(): Buffer {
  return envelope(PairingField.OPTION, writer => {
    writer.message(1, writeEncoding).varint(3, PairingRole.INPUT);
  });
}

export function encodePairingConfiguration(): Buffer {
  return envelope(PairingField.CONFIGURATION, writer => {
    writer.message(1, writeEncoding).varint(2, PairingRole.INPUT);
  });
}

export function encodePairingSecret(secret: Buffer): Buffer {
  return envelope(PairingField.SECRET, writer => writer.bytes(1, secret));
}

export function pairingMessageType(message: Buffer): number | undefined {
  return decodeFields(message).find(field => Object.values(PairingField).includes(field.number as never))?.number;
}

export function pairingStatus(message: Buffer): number | undefined {
  return firstNumber(decodeFields(message), 2);
}
