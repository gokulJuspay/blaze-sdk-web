// @ts-check
// Mirrors ostia src/lib/client/modules/sdk/helpers/native.ts.

import { generateRequestId, isJSON, readString } from '../utils.js';
import { logBridge } from './log.js';

/** @typedef {import('../types.js').Postman} Postman */
/** @typedef {import('../types.js').NativeInvokeParams} NativeInvokeParams */

const SOURCE = 'breeze';

/** @type {Map<string, (result: unknown) => void>} */
const callbackResolvers = new Map();

// Set by the standalone demo when there is no native bridge (plain desktop browser).
/** @type {Postman | null} */
let standalonePostman = null;

/** @returns {Postman | null} */
function getNativePostman() {
  const android = window.Native ?? null;
  if (android !== null && typeof android.onEvent === 'function') {
    return android.onEvent.bind(android);
  }

  const ios = window.webkit?.messageHandlers?.Native ?? null;
  if (ios !== null && typeof ios.postMessage === 'function') {
    return ios.postMessage.bind(ios);
  }

  return null;
}

export function isNative() {
  return getNativePostman() !== null;
}

/** @param {Postman | null} postman */
export function setStandalonePostman(postman) {
  standalonePostman = postman;
}

/**
 * @param {string} eventName
 * @param {string | null} eventData
 * @returns {boolean}
 */
export function sendToNative(eventName, eventData) {
  const postman = getNativePostman() ?? standalonePostman;
  if (postman === null) {
    return false;
  }

  try {
    postman(JSON.stringify({ source: SOURCE, eventName, eventData }));
    return true;
  } catch (e) {
    console.error('[simulator] failed to post to native', e);
    return false;
  }
}

/**
 * Resolves with methodResult, or null when undelivered or timed out.
 * @param {NativeInvokeParams} invokeParams
 * @returns {Promise<unknown>}
 */
export function invokeNativeMethod(invokeParams) {
  return new Promise((resolve) => {
    const requestId = generateRequestId();
    callbackResolvers.set(requestId, resolve);

    const invocation = {
      methodName: invokeParams.methodName,
      params: JSON.stringify(invokeParams.params),
      requestId
    };
    logBridge('out', 'invokeMethod', invocation);
    const delivered = sendToNative('invokeMethod', JSON.stringify(invocation));

    if (!delivered) {
      callbackResolvers.delete(requestId);
      resolve(null);
      return;
    }

    const timeout = invokeParams.timeout ?? null;
    if (timeout !== null) {
      setTimeout(() => {
        const pending = callbackResolvers.get(requestId) ?? null;
        if (pending !== null) {
          callbackResolvers.delete(requestId);
          pending(null);
        }
      }, timeout);
    }
  });
}

/**
 * @param {unknown} data
 * @returns {boolean}
 */
export function resolveNativeCallback(data) {
  if (!isJSON(data)) {
    return false;
  }
  const requestId = readString(data.requestId);
  const pending = requestId === null ? null : (callbackResolvers.get(requestId) ?? null);
  if (requestId === null || pending === null) {
    return false;
  }

  callbackResolvers.delete(requestId);
  // methodResult is polymorphic on the native side (Boolean, String or object).
  pending(data.methodResult ?? null);
  return true;
}
