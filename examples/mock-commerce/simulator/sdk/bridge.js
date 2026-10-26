// @ts-check
// Mirrors ostia src/lib/client/modules/sdk/helpers/bridge.ts.
//
// Native -> page: window.onSDKEvent(JSON.stringify({ source: 'blaze', eventName, eventData }))
// Page -> native: Native.onEvent / webkit.messageHandlers.Native.postMessage with
//                 JSON.stringify({ source: 'breeze', eventName, eventData: JSON.stringify(payload) })

import { isJSON, safeParseJSON } from '../utils.js';
import { flowRunner } from './core.js';
import { logBridge } from './log.js';
import { isNative, sendToNative } from './native.js';

const INBOUND_SOURCE = 'blaze';
const OUTBOUND_SOURCE = 'breeze';

let listening = false;

/**
 * @param {string} eventName
 * @param {string | null} eventData
 * @returns {boolean}
 */
function sendToParentFrame(eventName, eventData) {
  if (window.parent === window) {
    return false;
  }

  try {
    window.parent.postMessage(
      JSON.stringify({ source: OUTBOUND_SOURCE, eventName, eventData }),
      '*'
    );
    return true;
  } catch (e) {
    console.error('[simulator] failed to post to parent frame', e);
    return false;
  }
}

/**
 * @param {string} eventName
 * @param {unknown} [payload]
 */
export function sendEvent(eventName, payload = null) {
  const eventData = payload === null ? null : JSON.stringify(payload);
  logBridge('out', eventName, payload);
  sendToNative(eventName, eventData);
  sendToParentFrame(eventName, eventData);
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
function normalizeEnvelope(raw) {
  const envelope = typeof raw === 'string' ? safeParseJSON(raw) : raw;
  if (!isJSON(envelope)) {
    return null;
  }

  const eventData = envelope.eventData;
  if (typeof eventData === 'string') {
    return { ...envelope, eventData: safeParseJSON(eventData) };
  }
  return envelope;
}

/** @param {unknown} raw */
function processEnvelope(raw) {
  const envelope = normalizeEnvelope(raw);
  if (envelope === null || typeof envelope.eventName !== 'string') {
    return;
  }
  // Our own outbound messages echo back through window 'message' when framed.
  if (envelope.source !== INBOUND_SOURCE) {
    return;
  }

  logBridge('in', envelope.eventName, envelope.eventData);
  const result = flowRunner(envelope.eventName, envelope.eventData);
  if (result.response !== null) {
    sendEvent('callbackEvent', result.response);
  }
  for (const event of result.events) {
    sendEvent(event.eventName, event.payload);
  }
}

/** @param {MessageEvent} event */
function handleFrameMessage(event) {
  processEnvelope(event.data);
}

export function listen() {
  if (listening) {
    return;
  }

  listening = true;
  window.addEventListener('message', handleFrameMessage);
  window.onSDKEvent = processEnvelope;
}

export function emitAppReady() {
  if (isNative()) {
    sendEvent('appReady');
  }
  sendEvent('app-ready');
}

export function closeView() {
  sendEvent('hideView');
  sendEvent('releaseBackPress');
}
