import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  createMockCommerce,
  MAGIC_OTT_FAILURES,
  OTT_TTL_MS,
  SESSION_TTL_SECONDS,
  SLOW_OTT
} from '../server.mjs';
import { DEFAULT_KEY_PATH, exportPublicKeys, verifyJws } from '../sign-config.mjs';

const START_MS = Date.UTC(2026, 9, 26, 10, 15);

let clockMs = START_MS;
let server;
let baseUrl;

before(async () => {
  const { handle } = createMockCommerce({
    now: () => clockMs,
    slowOttDelayMs: 50,
    log: () => {}
  });
  server = createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  clockMs = START_MS;
});

async function call(method, path, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  return {
    status: response.status,
    body: contentType.startsWith('application/json') ? JSON.parse(text) : text
  };
}

async function mintOtt(body = {}) {
  const response = await call('POST', '/mock/ott', { body });
  assert.equal(response.status, 201);
  return response.body.ott;
}

const exchange = (ott, extra = {}) =>
  call('POST', '/auth/session/exchange', { body: { ott, ...extra } });

describe('one-time token exchange', () => {
  test('an OTT exchanges once for a 24 h HS256 session token', async () => {
    const ott = await mintOtt();
    const first = await exchange(ott);

    assert.equal(first.status, 200);
    assert.equal(first.body.tokenType, 'Bearer');
    assert.equal(first.body.expiresIn, SESSION_TTL_SECONDS);

    const [header, payload] = first.body.sessionToken
      .split('.')
      .slice(0, 2)
      .map((part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')));
    assert.deepEqual(header, { alg: 'HS256', typ: 'JWT' });
    assert.equal(payload.sub, 'demo');
    assert.equal(payload.exp - payload.iat, SESSION_TTL_SECONDS);

    const second = await exchange(ott);
    assert.equal(second.status, 401);
    assert.equal(second.body.error.code, 'OTT_USED');
  });

  test('an OTT is still valid just before 180 s', async () => {
    const ott = await mintOtt();
    clockMs += OTT_TTL_MS - 1;
    assert.equal((await exchange(ott)).status, 200);
  });

  test('an OTT expires at 180 s', async () => {
    const ott = await mintOtt();
    clockMs += OTT_TTL_MS;
    const response = await exchange(ott);
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'OTT_EXPIRED');
  });

  test('an unknown OTT is rejected', async () => {
    const response = await exchange('not-a-real-token');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'OTT_INVALID');
  });

  test('a device-bound OTT rejects another device and is burnt by the attempt', async () => {
    const ott = await mintOtt({ deviceBinding: 'device-a' });
    const mismatch = await exchange(ott, { deviceBinding: 'device-b' });
    assert.equal(mismatch.status, 401);
    assert.equal(mismatch.body.error.code, 'DEVICE_MISMATCH');

    const retry = await exchange(ott, { deviceBinding: 'device-a' });
    assert.equal(retry.body.error.code, 'OTT_USED');
  });

  test('a device-bound OTT exchanges on the bound device', async () => {
    const ott = await mintOtt({ deviceBinding: 'device-a' });
    assert.equal((await exchange(ott, { deviceBinding: 'device-a' })).status, 200);
  });

  test('a missing ott is a 400', async () => {
    const response = await call('POST', '/auth/session/exchange', { body: {} });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_REQUEST');
  });

  test('a non-JSON body is a 400', async () => {
    const response = await fetch(`${baseUrl}/auth/session/exchange`, {
      method: 'POST',
      body: 'not json'
    });
    assert.equal(response.status, 400);
  });
});

describe('magic tokens', () => {
  for (const [ott, failure] of Object.entries(MAGIC_OTT_FAILURES)) {
    test(`${ott} fails with ${failure.status} ${failure.code}`, async () => {
      const first = await exchange(ott);
      assert.equal(first.status, failure.status);
      assert.equal(first.body.error.code, failure.code);

      // Magic tokens are reusable so SDK tests can hit them repeatedly.
      assert.equal((await exchange(ott)).body.error.code, failure.code);
    });
  }

  test(`${SLOW_OTT} answers after the configured delay`, async () => {
    const startedAt = performance.now();
    const response = await exchange(SLOW_OTT);
    assert.equal(response.status, 200);
    assert.ok(performance.now() - startedAt >= 45);
  });
});

describe('sessions', () => {
  async function newSession() {
    return (await exchange(await mintOtt())).body.sessionToken;
  }

  test('ping accepts a live session', async () => {
    const response = await call('GET', '/mock/api/ping', { token: await newSession() });
    assert.equal(response.status, 200);
    assert.equal(response.body.tenantId, 'demo');
  });

  test('revoke -> ping 401, and sessions issued after the revoke still work', async () => {
    const revoked = await newSession();
    assert.equal((await call('POST', '/mock/revoke')).status, 200);

    const ping = await call('GET', '/mock/api/ping', { token: revoked });
    assert.equal(ping.status, 401);
    assert.equal(ping.body.error.code, 'SESSION_REVOKED');

    const fresh = await newSession();
    assert.equal((await call('GET', '/mock/api/ping', { token: fresh })).status, 200);
  });

  test('a session expires after 24 h', async () => {
    const token = await newSession();
    clockMs += SESSION_TTL_SECONDS * 1000;
    const ping = await call('GET', '/mock/api/ping', { token });
    assert.equal(ping.status, 401);
    assert.equal(ping.body.error.code, 'SESSION_EXPIRED');
  });

  test('ping rejects a missing or tampered token', async () => {
    assert.equal((await call('GET', '/mock/api/ping')).body.error.code, 'SESSION_MISSING');

    const [header, payload, signature] = (await newSession()).split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
        sub: 'other'
      })
    ).toString('base64url');
    const ping = await call('GET', '/mock/api/ping', {
      token: `${header}.${forged}.${signature}`
    });
    assert.equal(ping.status, 401);
    assert.equal(ping.body.error.code, 'SESSION_INVALID');
  });
});

describe('signed config', () => {
  const privateKeyPem = readFileSync(DEFAULT_KEY_PATH, 'utf8');

  test('config JWS verifies with the mock-1 public key', async () => {
    const response = await call('GET', '/mock/config');
    assert.equal(response.status, 200);

    const verified = verifyJws(response.body, createPublicKey(privateKeyPem));
    assert.notEqual(verified, null);
    assert.deepEqual(verified.header, { alg: 'ES256', kid: 'mock-1' });
    assert.equal(verified.payload.services['in.breeze.shop'].frameUrls.mock, `${baseUrl}/sdk`);
  });

  test('a tampered config JWS does not verify', async () => {
    const [header, , signature] = (await call('GET', '/mock/config')).body.split('.');
    const forged = Buffer.from(JSON.stringify({ services: {} })).toString('base64url');
    assert.equal(
      verifyJws(`${header}.${forged}.${signature}`, createPublicKey(privateKeyPem)),
      null
    );
  });

  test('exported Android (SPKI) and iOS (X9.63) keys are the mock-1 public key', async () => {
    const jws = (await call('GET', '/mock/config')).body;
    const { spki, x963 } = exportPublicKeys(privateKeyPem);

    const androidKey = createPublicKey({
      key: Buffer.from(spki, 'base64'),
      format: 'der',
      type: 'spki'
    });
    assert.notEqual(verifyJws(jws, androidKey), null);

    const point = Buffer.from(x963, 'base64');
    assert.equal(point.length, 65);
    assert.equal(point[0], 0x04);
    const iosKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url')
      },
      format: 'jwk'
    });
    assert.notEqual(verifyJws(jws, iosKey), null);
  });
});

// Sends the path byte-for-byte; fetch() would normalise '..' segments before they reach the server.
function rawGet(path) {
  return new Promise((resolve, reject) => {
    const req = request(`${baseUrl}${path}`, { method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('simulator assets', () => {
  test('GET /sdk serves the simulator page, its modules, styles, icons and fixtures', async () => {
    const page = await call('GET', '/sdk');
    assert.equal(page.status, 200);
    assert.match(page.body, /<script type="module" src="\/sdk\/app\.js">/);

    for (const path of [
      '/sdk/app.js',
      '/sdk/sdk/bridge.js',
      '/sdk/journey/store.js',
      '/sdk/catalog/store.js',
      '/sdk/styles/shop.css',
      '/sdk/assets/icon-close.svg'
    ]) {
      assert.equal((await call('GET', path)).status, 200, path);
    }

    const results = await call('GET', '/sdk/fixtures/results.json');
    assert.deepEqual(results.body.completed.orderIds, ['MOCK-ORDER-1']);
  });

  test('GET /sdk/dashboard serves the merchant dashboard', async () => {
    const page = await call('GET', '/sdk/dashboard');
    assert.equal(page.status, 200);
    assert.match(page.body, /<script type="module" src="\/sdk\/dashboard\.js">/);
    assert.equal((await call('GET', '/sdk/dashboard.js')).status, 200);
  });

  test('type-check files, other file types and paths outside simulator/ are a 404', async () => {
    for (const path of [
      '/sdk/jsconfig.json',
      '/sdk/global.d.ts',
      '/sdk/missing.js',
      '/sdk/journey',
      '/nope'
    ]) {
      assert.equal((await call('GET', path)).status, 404, path);
    }
    for (const path of [
      '/sdk/../server.mjs',
      '/sdk/..%2fserver.mjs',
      '/sdk/fixtures/../keys/mock-1.pem'
    ]) {
      assert.equal(await rawGet(path), 404, path);
    }
  });
});
