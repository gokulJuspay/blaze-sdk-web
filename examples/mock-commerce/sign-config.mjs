#!/usr/bin/env node
// Signs SDK config JSON as a compact ES256 JWS and exports the matching public key for the
// native SDKs. keys/mock-1.pem is a TEST-ONLY key: the SDKs must trust kid "mock-1" only when
// running with BlazeEnvironment.MOCK.
//
//   node sign-config.mjs config.json              print the JWS for config.json
//   node sign-config.mjs --export-public          print SPKI (Android) and X9.63 (iOS) base64
//   options: --key <pem path> (default keys/mock-1.pem), --kid <kid> (default mock-1)

import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_KEY_PATH = join(ROOT, 'keys', 'mock-1.pem');
export const DEFAULT_KID = 'mock-1';

const toBase64Url = (value) => Buffer.from(value).toString('base64url');

export function signJws(payload, { privateKeyPem, kid = DEFAULT_KID }) {
  const header = toBase64Url(JSON.stringify({ alg: 'ES256', kid }));
  const body = toBase64Url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  // JWS needs the raw r||s signature (IEEE P1363), not the DER encoding Node emits by default.
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(privateKeyPem),
    dsaEncoding: 'ieee-p1363'
  });
  return `${signingInput}.${toBase64Url(signature)}`;
}

// Returns { header, payload } when the signature is valid, otherwise null.
export function verifyJws(jws, publicKey) {
  const parts = typeof jws === 'string' ? jws.split('.') : [];
  if (parts.length !== 3) {
    return null;
  }

  const [header, body, signature] = parts;
  try {
    const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (decodedHeader.alg !== 'ES256') {
      return null;
    }
    const isValid = verify(
      'sha256',
      Buffer.from(`${header}.${body}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url')
    );
    if (!isValid) {
      return null;
    }
    return {
      header: decodedHeader,
      payload: JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    };
  } catch {
    return null;
  }
}

// spki: X.509 SubjectPublicKeyInfo DER, for Android's X509EncodedKeySpec.
// x963: uncompressed point 0x04||X||Y, for iOS SecKeyCreateWithData (kSecAttrKeyTypeECSECPrimeRandom).
export function exportPublicKeys(privateKeyPem) {
  const publicKey = createPublicKey(privateKeyPem);
  const jwk = publicKey.export({ format: 'jwk' });
  const x963 = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url')
  ]);
  return {
    spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    x963: x963.toString('base64')
  };
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      key: { type: 'string', default: DEFAULT_KEY_PATH },
      kid: { type: 'string', default: DEFAULT_KID },
      'export-public': { type: 'boolean', default: false }
    }
  });
  const privateKeyPem = readFileSync(values.key, 'utf8');

  if (values['export-public']) {
    const { spki, x963 } = exportPublicKeys(privateKeyPem);
    console.log(`kid:     ${values.kid}`);
    console.log(`android: ${spki}`);
    console.log(`ios:     ${x963}`);
    return;
  }

  if (positionals.length !== 1) {
    console.error('Usage: node sign-config.mjs [--key <pem>] [--kid <kid>] <config.json>');
    console.error('       node sign-config.mjs [--key <pem>] --export-public');
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(positionals[0], 'utf8'));
  console.log(signJws(config, { privateKeyPem, kid: values.kid }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
