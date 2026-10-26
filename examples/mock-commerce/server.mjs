#!/usr/bin/env node
// Mock Commerce backend for the Blaze native SDK preview (S117.1). Node 20+, zero dependencies.
// All state is in memory and is lost on restart. See README.md for the endpoint contract.

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_KEY_PATH, DEFAULT_KID, signJws } from './sign-config.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

export const OTT_TTL_MS = 180 * 1000;
export const SESSION_TTL_SECONDS = 24 * 60 * 60;
export const DEFAULT_TENANT_ID = 'demo';
export const SLOW_OTT = 'mock-ott-slow';

// Magic one-time tokens that always fail the exchange in a fixed way, for SDK error paths.
export const MAGIC_OTT_FAILURES = {
  'mock-ott-expired': { status: 401, code: 'OTT_EXPIRED', message: 'One-time token has expired' },
  'mock-ott-used': { status: 401, code: 'OTT_USED', message: 'One-time token was already used' },
  'mock-ott-invalid': { status: 401, code: 'OTT_INVALID', message: 'Unknown one-time token' },
  'mock-ott-server-error': { status: 500, code: 'INTERNAL_ERROR', message: 'Mock server error' }
};

const SESSION_ID_PREFIX = 'mock-session-';
const MAX_BODY_BYTES = 64 * 1024;

const SIMULATOR_DIR = join(ROOT, 'simulator');
const FIXTURES_DIR = join(ROOT, 'fixtures');
const PAGE_ROUTES = {
  '/sdk': 'index.html',
  '/sdk/': 'index.html',
  '/sdk/dashboard': 'dashboard.html'
};
// Only these file types are served; type-check files (jsconfig.json, global.d.ts) are not.
const SIMULATOR_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};
const FIXTURE_TYPES = { '.json': 'application/json' };

// Maps a /sdk path to { filePath, type } inside simulator/ or fixtures/, or null.
function resolveStaticFile(pathname) {
  const page = PAGE_ROUTES[pathname];
  if (page !== undefined) {
    return { filePath: join(SIMULATOR_DIR, page), type: SIMULATOR_TYPES['.html'] };
  }
  if (!pathname.startsWith('/sdk/')) {
    return null;
  }

  const relative = pathname.slice('/sdk/'.length);
  const isFixture = relative.startsWith('fixtures/');
  const baseDir = isFixture ? FIXTURES_DIR : SIMULATOR_DIR;
  const filePath = resolve(baseDir, isFixture ? relative.slice('fixtures/'.length) : relative);
  if (!filePath.startsWith(`${baseDir}${sep}`)) {
    return null;
  }
  const type = (isFixture ? FIXTURE_TYPES : SIMULATOR_TYPES)[extname(filePath)];
  return type === undefined ? null : { filePath, type };
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const toBase64Url = (value) => Buffer.from(value).toString('base64url');

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendError(res, error) {
  sendJson(res, error.status, { error: { code: error.code, message: error.message } });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    chunks.push(chunk);
  }
  if (size === 0) {
    return {};
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new Error('not an object');
    }
    return body;
  } catch {
    throw new HttpError(400, 'INVALID_REQUEST', 'Body must be a JSON object');
  }
}

function optionalString(body, field) {
  const value = body[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, 'INVALID_REQUEST', `${field} must be a non-empty string`);
  }
  return value;
}

function requestOrigin(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto =
    typeof forwardedProto === 'string'
      ? forwardedProto.split(',')[0].trim()
      : req.socket.encrypted
        ? 'https'
        : 'http';
  return `${proto}://${req.headers.host}`;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createMockCommerce({
  now = Date.now,
  sessionSecret = randomBytes(32),
  configKeyPem = readFileSync(DEFAULT_KEY_PATH, 'utf8'),
  configKid = DEFAULT_KID,
  slowOttDelayMs = 10_000,
  log = (line) => console.log(line)
} = {}) {
  // ott -> { tenantId, expiresAt (ms), used, deviceBinding }
  const otts = new Map();
  let sessionSeq = 0;
  // Sessions with seq <= revokeCutoff are rejected (POST /mock/revoke).
  let revokeCutoff = 0;

  function signSessionToken(claims) {
    const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = toBase64Url(JSON.stringify(claims));
    const signature = createHmac('sha256', sessionSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    return `${header}.${payload}.${signature}`;
  }

  function issueSession(tenantId, deviceBinding) {
    sessionSeq += 1;
    const iat = Math.floor(now() / 1000);
    const exp = iat + SESSION_TTL_SECONDS;
    const claims = {
      iss: 'blaze-mock',
      sub: tenantId,
      sid: `${SESSION_ID_PREFIX}${sessionSeq}`,
      iat,
      exp,
      ...(deviceBinding === null ? {} : { deviceBinding })
    };
    return {
      sessionToken: signSessionToken(claims),
      tokenType: 'Bearer',
      expiresIn: SESSION_TTL_SECONDS,
      expiresAt: new Date(exp * 1000).toISOString()
    };
  }

  function verifySession(authorization) {
    const match = /^Bearer (\S+)$/.exec(authorization ?? '');
    if (match === null) {
      throw new HttpError(401, 'SESSION_MISSING', 'Missing bearer session token');
    }

    const parts = match[1].split('.');
    if (parts.length !== 3) {
      throw new HttpError(401, 'SESSION_INVALID', 'Malformed session token');
    }
    const expected = createHmac('sha256', sessionSecret).update(`${parts[0]}.${parts[1]}`).digest();
    const actual = Buffer.from(parts[2], 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new HttpError(401, 'SESSION_INVALID', 'Session token signature is invalid');
    }

    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims.exp <= Math.floor(now() / 1000)) {
      throw new HttpError(401, 'SESSION_EXPIRED', 'Session has expired');
    }
    if (Number(claims.sid.slice(SESSION_ID_PREFIX.length)) <= revokeCutoff) {
      throw new HttpError(401, 'SESSION_REVOKED', 'Session was revoked');
    }
    return claims;
  }

  async function mintOtt(req, res) {
    const body = await readJsonBody(req);
    const tenantId = optionalString(body, 'tenantId') ?? DEFAULT_TENANT_ID;
    const deviceBinding = optionalString(body, 'deviceBinding');
    const ott = `mock-ott-${randomUUID()}`;
    const expiresAt = now() + OTT_TTL_MS;
    otts.set(ott, { tenantId, expiresAt, used: false, deviceBinding });
    sendJson(res, 201, {
      ott,
      expiresIn: OTT_TTL_MS / 1000,
      expiresAt: new Date(expiresAt).toISOString()
    });
  }

  async function exchangeSession(req, res) {
    const body = await readJsonBody(req);
    const ott = optionalString(body, 'ott');
    if (ott === null) {
      throw new HttpError(400, 'INVALID_REQUEST', 'ott is required');
    }
    const deviceBinding = optionalString(body, 'deviceBinding');

    const magicFailure = MAGIC_OTT_FAILURES[ott];
    if (magicFailure !== undefined) {
      throw new HttpError(magicFailure.status, magicFailure.code, magicFailure.message);
    }
    if (ott === SLOW_OTT) {
      await delay(slowOttDelayMs);
      sendJson(res, 200, issueSession(DEFAULT_TENANT_ID, deviceBinding));
      return;
    }

    const record = otts.get(ott);
    if (record === undefined) {
      throw new HttpError(401, 'OTT_INVALID', 'Unknown one-time token');
    }
    if (record.used) {
      throw new HttpError(401, 'OTT_USED', 'One-time token was already used');
    }
    // Any presentation of a known OTT burns it, including the failed ones below.
    record.used = true;
    if (now() >= record.expiresAt) {
      throw new HttpError(401, 'OTT_EXPIRED', 'One-time token has expired');
    }
    if (record.deviceBinding !== null && record.deviceBinding !== deviceBinding) {
      throw new HttpError(401, 'DEVICE_MISMATCH', 'One-time token is bound to another device');
    }
    sendJson(res, 200, issueSession(record.tenantId, record.deviceBinding));
  }

  function revokeSessions(res) {
    revokeCutoff = sessionSeq;
    sendJson(res, 200, { revokedThrough: revokeCutoff });
  }

  function ping(req, res) {
    const claims = verifySession(req.headers.authorization);
    sendJson(res, 200, { ok: true, tenantId: claims.sub, sessionId: claims.sid });
  }

  function signedConfig(req, res) {
    const origin = requestOrigin(req);
    const config = {
      issuedAt: new Date(now()).toISOString(),
      services: {
        'in.breeze.shop': {
          apiHost: origin,
          frameUrls: { mock: `${origin}/sdk` }
        }
      }
    };
    res.writeHead(200, { 'Content-Type': 'application/jose' });
    res.end(signJws(config, { privateKeyPem: configKeyPem, kid: configKid }));
  }

  async function serveStatic(res, file, pathname) {
    let content;
    try {
      content = await readFile(file.filePath);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
        throw new HttpError(404, 'NOT_FOUND', `No file for ${pathname}`);
      }
      throw error;
    }
    res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-store' });
    res.end(content);
  }

  const routes = {
    'POST /mock/ott': mintOtt,
    'POST /auth/session/exchange': exchangeSession,
    'POST /mock/revoke': (_req, res) => revokeSessions(res),
    'GET /mock/api/ping': ping,
    'GET /mock/config': signedConfig
  };

  async function handle(req, res) {
    const { pathname } = new URL(req.url ?? '/', 'http://mock.local');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.on('finish', () => log(`${req.method} ${pathname} -> ${res.statusCode}`));

    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const route = routes[`${req.method} ${pathname}`];
      if (route !== undefined) {
        await route(req, res);
        return;
      }

      const file = req.method === 'GET' ? resolveStaticFile(pathname) : null;
      if (file !== null) {
        await serveStatic(res, file, pathname);
        return;
      }

      throw new HttpError(404, 'NOT_FOUND', `No route for ${req.method} ${pathname}`);
    } catch (error) {
      if (error instanceof HttpError) {
        sendError(res, error);
      } else {
        log(`Unhandled error: ${error?.stack ?? error}`);
        sendError(res, new HttpError(500, 'INTERNAL_ERROR', 'Unexpected mock server error'));
      }
    }
  }

  return { handle };
}

function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: process.env.PORT ?? '8787' },
      host: { type: 'string', default: '0.0.0.0' },
      'tls-cert': { type: 'string' },
      'tls-key': { type: 'string' }
    }
  });

  const certPath = values['tls-cert'];
  const keyPath = values['tls-key'];
  if ((certPath === undefined) !== (keyPath === undefined)) {
    console.error('--tls-cert and --tls-key must be passed together');
    process.exit(1);
  }

  const { handle } = createMockCommerce();
  const useTls = certPath !== undefined;
  const server = useTls
    ? createHttpsServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, handle)
    : createHttpServer(handle);

  server.listen(Number(values.port), values.host, () => {
    const scheme = useTls ? 'https' : 'http';
    console.log(`Mock Commerce listening on ${scheme}://${values.host}:${values.port}`);
    console.log(`Simulator: ${scheme}://localhost:${values.port}/sdk`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
