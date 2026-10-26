// @ts-check
// Mirrors ostia src/lib/client/modules/sdk/helpers/core.ts: maps an inbound SDK event to the
// callbackEvent response plus the bridge events to send back. The journey plugs in via hooks.

import { generateRequestId, isJSON, readString } from '../utils.js';
import { isNative, resolveNativeCallback } from './native.js';

/** @typedef {import('../types.js').SdkResponse} SdkResponse */
/** @typedef {import('../types.js').SdkFlowResult} SdkFlowResult */
/** @typedef {import('../types.js').SdkFlowEvent} SdkFlowEvent */
/** @typedef {import('../types.js').JourneyHooks} JourneyHooks */

const SERVICE = 'in.breeze.shop';

/** @type {SdkFlowEvent[]} */
export const RENDER_EVENTS = [
  { eventName: 'renderView', payload: null },
  { eventName: 'consumeBackPress', payload: null }
];

/** @type {SdkFlowEvent[]} */
export const EXIT_EVENTS = [
  { eventName: 'hideView', payload: null },
  { eventName: 'releaseBackPress', payload: null }
];

/** @type {JourneyHooks | null} */
let journeyHooks = null;

/** @param {JourneyHooks} hooks */
export function setJourneyHooks(hooks) {
  journeyHooks = hooks;
}

/**
 * @param {string} requestId
 * @param {string} service
 * @param {string} eventName
 * @param {Record<string, unknown>} payload
 * @returns {SdkResponse}
 */
export function toSdkResponse(requestId, service, eventName, payload) {
  return {
    requestId,
    service,
    payload: {
      eventName,
      action: null,
      status: null,
      methodName: null,
      event: null,
      error: null,
      errorDetails: null,
      ...payload
    }
  };
}

/** @param {unknown} data */
function readRequestId(data) {
  return (isJSON(data) ? readString(data.requestId) : null) ?? generateRequestId();
}

/** @param {unknown} data */
function readService(data) {
  return (isJSON(data) ? readString(data.service) : null) ?? SERVICE;
}

/**
 * @param {unknown} data
 * @param {string} eventName
 * @param {string} errorDetails
 * @returns {SdkFlowResult}
 */
function errorResponse(data, eventName, errorDetails) {
  return {
    handled: true,
    events: [],
    response: toSdkResponse(readRequestId(data), readService(data), eventName, {
      error: true,
      errorDetails
    })
  };
}

/**
 * @param {unknown} data
 * @returns {SdkFlowResult}
 */
function handleInitiate(data) {
  const payload = isJSON(data) && isJSON(data.payload) ? data.payload : null;
  if (payload === null) {
    return errorResponse(data, 'initiate', 'Incorrect payload');
  }
  if (readString(payload.publisherId) === null) {
    return errorResponse(data, 'initiate', 'Missing publisherId in initiate payload');
  }

  return {
    handled: true,
    events: [],
    response: toSdkResponse(readRequestId(data), readService(data), 'initiate', {
      status: 'success'
    })
  };
}

/**
 * @param {unknown} data
 * @returns {SdkFlowResult}
 */
function handleProcess(data) {
  const payload = isJSON(data) && isJSON(data.payload) ? data.payload : null;
  if (payload === null) {
    return errorResponse(data, 'process', 'Incorrect payload');
  }

  const requestId = readRequestId(data);
  const service = readService(data);
  const action = readString(payload.action);
  if (action !== 'launch') {
    return {
      handled: true,
      events: [],
      response: toSdkResponse(requestId, service, 'processResult', {
        action,
        status: 'failed',
        error: true,
        errorCode: 'UNSUPPORTED_ACTION',
        errorDetails: `The simulator only handles action 'launch' (got '${action}')`
      })
    };
  }

  if (journeyHooks === null) {
    return errorResponse(data, 'process', 'Simulator is still loading');
  }
  return journeyHooks.launch({
    requestId,
    service,
    sessionToken: readString(payload.sessionToken)
  });
}

/**
 * @param {string} eventName
 * @param {unknown} data
 * @returns {SdkFlowResult}
 */
export function flowRunner(eventName, data) {
  switch (eventName.toLowerCase()) {
    case 'initiate':
      return handleInitiate(data);
    case 'process':
      return handleProcess(data);
    case 'invokemethodresult':
      return { handled: resolveNativeCallback(data), events: [], response: null };
    case 'backpress':
      return journeyHooks?.backPress() ?? { handled: true, events: EXIT_EVENTS, response: null };
    case 'terminate':
      journeyHooks?.terminate();
      return { handled: true, events: [], response: null };
    case 'ping':
      return {
        handled: true,
        events: [],
        response: toSdkResponse(readRequestId(data), readService(data), 'pong', {
          status: isNative() ? 'native' : 'web'
        })
      };
    default:
      return { handled: false, events: [], response: null };
  }
}
