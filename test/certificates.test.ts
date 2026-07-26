import assert from 'node:assert/strict';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import test from 'node:test';
import tls from 'node:tls';
import { createClientCertificate } from '../src/protocol/certificates';

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
