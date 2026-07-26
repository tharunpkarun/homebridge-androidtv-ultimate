import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import forge from 'node-forge';
import type { DeviceCredentials } from '../types';

export interface ClientCertificate {
  certificate: string;
  privateKey: string;
  fingerprint: string;
}

export function createClientCertificate(commonName: string): ClientCertificate {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = `01${randomBytes(15).toString('hex')}`;
  certificate.validity.notBefore = new Date(Date.now() - 60_000);
  certificate.validity.notAfter = new Date();
  certificate.validity.notAfter.setFullYear(certificate.validity.notAfter.getFullYear() + 20);

  // Android TV names are advertised as UTF-8 and may contain scripts, emoji,
  // or smart punctuation that cannot be represented as an X.509
  // PrintableString. Explicitly encode the common name as UTF8String so
  // OpenSSL can parse the generated certificate on every supported Node.js
  // version.
  const attributes = [{ name: 'commonName', value: commonName, valueTagClass: forge.asn1.Type.UTF8 }];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', clientAuth: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  certificate.sign(keys.privateKey, forge.md.sha256.create());

  const certificatePem = forge.pki.certificateToPem(certificate);
  const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes(), 'binary');
  return {
    certificate: certificatePem,
    privateKey: privateKeyPem,
    fingerprint: createHash('sha256').update(der).digest('hex').match(/.{2}/g)?.join(':').toUpperCase() ?? '',
  };
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function rsaParts(certificate: string | Buffer): [Buffer, Buffer] {
  const x509 = new X509Certificate(certificate);
  const jwk = x509.publicKey.export({ format: 'jwk' });
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) {
    throw new Error('Android TV pairing requires an RSA certificate');
  }
  return [decodeBase64Url(jwk.n), decodeBase64Url(jwk.e)];
}

export function calculatePairingSecret(clientCertificate: string, serverCertificate: Buffer, code: string): Buffer {
  const normalized = code.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(normalized)) {
    throw new Error('The pairing code must contain exactly six hexadecimal characters');
  }

  const [clientModulus, clientExponent] = rsaParts(clientCertificate);
  const [serverModulus, serverExponent] = rsaParts(serverCertificate);
  const secret = Buffer.from(normalized.slice(2), 'hex');
  const digest = createHash('sha256')
    .update(clientModulus)
    .update(clientExponent)
    .update(serverModulus)
    .update(serverExponent)
    .update(secret)
    .digest();

  if (digest[0] !== Number.parseInt(normalized.slice(0, 2), 16)) {
    throw new Error('The pairing code did not match this TV');
  }
  return digest;
}

export function toDeviceCredentials(
  deviceId: string,
  clientName: string,
  certificate: ClientCertificate,
): DeviceCredentials {
  return {
    deviceId,
    clientName,
    certificate: certificate.certificate,
    privateKey: certificate.privateKey,
    fingerprint: certificate.fingerprint,
    pairedAt: new Date().toISOString(),
    protocol: 'remote-service-v2',
  };
}
