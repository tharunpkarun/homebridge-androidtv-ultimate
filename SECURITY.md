# Security policy

Please report vulnerabilities privately through GitHub's security advisory feature for this repository. Do not open a public issue containing credentials, certificates, private keys, pairing codes, IP addresses, or Homebridge backups.

Pairing credentials are local mutual-TLS client identities. Treat `androidtv-ultimate/credentials.json` as a secret. The plugin writes it with owner-only permissions and excludes credential material from its diagnostics endpoint.

Supported security fixes target the latest released major version.
