import assert from 'node:assert/strict';
import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import test from 'node:test';
import tls from 'node:tls';
import { calculatePairingSecret, createClientCertificate } from '../src/protocol/certificates';

const unicodeTvNames = [
  'Homebridge טלוויזיה',
  'Homebridge 📺 TV',
  'Homebridge Tharun’s TV',
  'Homebridge 电视',
  'Homebridge телевизор',
];

test('client certificates support Unicode Android TV names', () => {
  for (const name of unicodeTvNames) {
    const credentials = createClientCertificate(name);
    const certificate = new X509Certificate(credentials.certificate);

    assert.equal(certificate.subject, `CN=${name}`);
    assert.doesNotThrow(() => createPrivateKey(credentials.privateKey));
    assert.doesNotThrow(() => tls.createSecureContext({
      cert: credentials.certificate,
      key: credentials.privateKey,
    }));
  }
});

function rsaParts(certificate: string): [Buffer, Buffer] {
  const jwk = new X509Certificate(certificate).publicKey.export({ format: 'jwk' });
  assert.equal(jwk.kty, 'RSA');
  assert.ok(jwk.n);
  assert.ok(jwk.e);
  return [Buffer.from(jwk.n, 'base64url'), Buffer.from(jwk.e, 'base64url')];
}

test('pairing secret hashes raw TLS RSA parameters without sign padding', () => {
  const client = createClientCertificate('Homebridge Test');
  const server = createClientCertificate('Android TV Test');
  const [clientModulus, clientExponent] = rsaParts(client.certificate);
  const [serverModulus, serverExponent] = rsaParts(server.certificate);
  const codeTail = 'A1B2';
  const expected = createHash('sha256')
    .update(clientModulus)
    .update(clientExponent)
    .update(serverModulus)
    .update(serverExponent)
    .update(Buffer.from(codeTail, 'hex'))
    .digest();
  const code = `${expected.subarray(0, 1).toString('hex')}${codeTail}`;
  const serverDer = new X509Certificate(server.certificate).raw;

  assert.deepEqual(calculatePairingSecret(client.certificate, serverDer, code), expected);
});
