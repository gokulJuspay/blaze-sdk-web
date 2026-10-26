// @ts-check
// Standalone demo: when the page is opened in a plain browser (no native bridge, no parent
// frame) this module plays the native SDK, so the journey can be checked without a device.

import { generateRequestId, isJSON, readString, safeParseJSON } from '../utils.js';
import { isNative, setStandalonePostman } from './native.js';

const SERVICE = 'in.breeze.shop';
const TENANT_ID = 'demo';

export function isStandalone() {
  return !isNative() && window.parent === window;
}

/**
 * Hands a message to the page exactly as a native SDK would.
 * @param {string} eventName
 * @param {Record<string, unknown>} eventData
 */
function deliver(eventName, eventData) {
  setTimeout(() => window.onSDKEvent?.(JSON.stringify({ source: 'blaze', eventName, eventData })));
}

/**
 * @param {string} path
 * @param {Record<string, unknown>} body
 * @returns {Promise<Record<string, unknown>>}
 */
async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${json?.error?.code ?? ''}`);
  }
  return json;
}

// The OTT flow a real app goes through: BT's server mints, the SDK exchanges.
async function newSessionToken() {
  const minted = await postJson('/mock/ott', { tenantId: TENANT_ID });
  const exchanged = await postJson('/auth/session/exchange', { ott: minted.ott });
  return readString(exchanged.sessionToken);
}

/**
 * @param {string} methodName
 * @param {Record<string, unknown> | null} params
 * @returns {Promise<unknown>}
 */
async function answerInvocation(methodName, params) {
  if (methodName === 'runSca') {
    return { status: 'success', scaId: params?.scaId ?? null };
  }
  if (methodName === 'refreshSession') {
    return { sessionToken: await newSessionToken() };
  }
  return 'Method not found';
}

/** @param {string} message */
function standalonePostman(message) {
  const envelope = safeParseJSON(message);
  if (envelope === null || envelope.eventName !== 'invokeMethod') {
    return;
  }
  const invocation =
    typeof envelope.eventData === 'string' ? safeParseJSON(envelope.eventData) : null;
  if (invocation === null || !isJSON(invocation)) {
    return;
  }

  const methodName = readString(invocation.methodName) ?? '';
  const params = typeof invocation.params === 'string' ? safeParseJSON(invocation.params) : null;
  answerInvocation(methodName, params)
    .catch((e) => `Standalone native failed: ${e.message}`)
    .then((methodResult) =>
      deliver('invokeMethodResult', { requestId: invocation.requestId, methodName, methodResult })
    );
}

export function installStandaloneNative() {
  setStandalonePostman(standalonePostman);
}

export async function startStandaloneJourney() {
  const sessionToken = await newSessionToken();
  deliver('initiate', {
    requestId: generateRequestId(),
    service: SERVICE,
    payload: { publisherId: TENANT_ID, environment: 'mock' }
  });
  deliver('process', {
    requestId: generateRequestId(),
    service: SERVICE,
    payload: { action: 'launch', sessionToken }
  });
}
