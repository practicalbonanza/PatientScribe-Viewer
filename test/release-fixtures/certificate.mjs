/**
 * A certificate that exists for one run and is never written down.
 *
 * The origin a release is deployed to answers over TLS, so a capture client that
 * has only ever been driven over a plain socket is a client whose TLS path is
 * untested — and the TLS path is where certificate verification lives, which is
 * the part that decides whether the origin measured is the origin named. So one
 * fixture is served over TLS, and serving over TLS needs a certificate.
 *
 * Minted at run time, into a temporary directory, and removed when the run ends.
 * Not committed, not cached, not reused between runs: a certificate in a
 * repository is a private key in a repository, whatever it was for, and the
 * repository rules say there are none of those here. The system tool is invoked
 * because it is already installed and already audited; generating a key in
 * process would be the same private key with more code around it.
 *
 * The certificate names `localhost` and the loopback address, which is what lets
 * the capture client send a server name, verify the certificate against it, and
 * still connect to a literal address rather than resolving anything.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A minted certificate and the key that goes with it.
 *
 * @typedef {object} Certificate
 * @property {string} key PEM.
 * @property {string} cert PEM.
 * @property {() => void} discard Removes the directory the two were written to.
 */

/**
 * Mint one.
 *
 * @returns {Certificate}
 */
export function mintCertificate() {
  const directory = mkdtempSync(join(tmpdir(), 'release-check-tls-'));
  const keyFile = join(directory, 'key.pem');
  const certFile = join(directory, 'cert.pem');

  const result = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-days',
      '1',
      '-nodes',
      '-keyout',
      keyFile,
      '-out',
      certFile,
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error(`release-check fixtures: a certificate could not be minted: ${result.stderr || result.error?.message || 'unknown'}`);
  }

  return {
    key: readFileSync(keyFile, 'utf8'),
    cert: readFileSync(certFile, 'utf8'),
    discard: () => rmSync(directory, { recursive: true, force: true }),
  };
}
