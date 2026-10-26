// @ts-check
// Journey state and transitions for the website-style simulator:
// Search → Product → Cart → Checkout → Address → Confirm → Pay → Done.
// Each screen sends its eventStream fixture when the shopper reaches it, and the journey ends with
// exactly one processResult followed by hideView + releaseBackPress.

import { loadProducts, toMinorUnits } from '../catalog/store.js';
import { closeView, sendEvent } from '../sdk/bridge.js';
import { EXIT_EVENTS, RENDER_EVENTS, toSdkResponse } from '../sdk/core.js';
import { invokeNativeMethod } from '../sdk/native.js';
import { isJSON, readString, redact } from '../utils.js';
import { fixtures } from './fixtures.js';

/** @typedef {import('../types.js').Product} Product */
/** @typedef {import('../types.js').StepKey} StepKey */
/** @typedef {import('../types.js').JourneyPhase} JourneyPhase */
/** @typedef {import('../types.js').LaunchRequest} LaunchRequest */
/** @typedef {import('../types.js').SdkFlowResult} SdkFlowResult */
/** @typedef {import('../types.js').Notice} Notice */

/** @type {StepKey[]} */
export const STEPS = ['search', 'product', 'cart', 'checkout', 'address', 'confirm', 'pay', 'done'];
export const STEP = /** @type {Record<StepKey, number>} */ (
  Object.fromEntries(STEPS.map((key, index) => [key, index]))
);
// Journey open, session still being validated; the UI shows a loading grid.
export const LOADING_STEP = -1;

export const ADDRESS_LINE = '123 Main Street, Bengaluru 560001';
export const ORDER_ID = 'MOCK-ORDER-1';
export const MAX_QUANTITY = 10;
const INVOKE_TIMEOUT_MS = 30000;

/**
 * @typedef {object} JourneyState
 * @property {JourneyPhase} phase
 * @property {string} requestId
 * @property {string} service
 * @property {string | null} sessionToken
 * @property {Product[]} products
 * @property {string} query
 * @property {Product[]} results
 * @property {Product | null} selected
 * @property {number} quantity
 * @property {number} step
 * @property {Notice | null} notice
 * @property {string | null} endedStatus
 * @property {boolean} busy
 */

/** @type {JourneyState} */
const state = {
  phase: 'waiting',
  requestId: '',
  service: '',
  sessionToken: null,
  products: [],
  query: '',
  results: [],
  selected: null,
  quantity: 1,
  step: LOADING_STEP,
  notice: null,
  endedStatus: null,
  busy: false
};

/** @type {Set<(state: Readonly<JourneyState>) => void>} */
const listeners = new Set();

/** @param {(state: Readonly<JourneyState>) => void} listener */
export function subscribe(listener) {
  listeners.add(listener);
  listener(state);
}

function notify() {
  listeners.forEach((listener) => listener(state));
}

/**
 * @param {string} text
 * @param {{ pending?: boolean, tone?: Notice['tone'] }} [options]
 */
function setNotice(text, { pending = false, tone = 'info' } = {}) {
  state.notice = { text, pending, tone };
  notify();
}

/**
 * @param {string} eventName
 * @param {Record<string, unknown>} fields
 */
function sendCallback(eventName, fields) {
  sendEvent('callbackEvent', toSdkResponse(state.requestId, state.service, eventName, fields));
}

/** Total for the cart (selected product × quantity) in wire format. */
export function cartTotal() {
  const rupees = (state.selected?.price ?? 0) * state.quantity;
  return { rupees, wire: { amount: toMinorUnits(rupees), currency: 'INR' } };
}

// Fixture eventData with the product fields swapped for the shopper's choice, so the payload
// shape always matches fixtures/events.json.
/** @param {StepKey} key */
function stepEventData(key) {
  const base = fixtures.events[key].eventData;
  const total = cartTotal().wire;
  switch (key) {
    case 'search':
      return { ...base, query: state.query, resultCount: state.results.length };
    case 'product':
      return {
        ...base,
        productId: state.selected?.id ?? null,
        name: state.selected?.name ?? null,
        price: { amount: toMinorUnits(state.selected?.price ?? 0), currency: 'INR' }
      };
    case 'cart':
      return { ...base, itemCount: state.quantity, total };
    case 'pay':
      return { ...base, amount: total };
    case 'checkout':
    case 'confirm':
    case 'done':
      return { ...base, total };
    default:
      return base;
  }
}

/**
 * Shows a screen and sends its eventStream event.
 * @param {StepKey} key
 */
function enterStep(key) {
  state.step = STEP[key];
  sendCallback('eventStream', {
    action: 'launch',
    event: fixtures.events[key].event,
    eventData: stepEventData(key),
    timestamp: Date.now()
  });
}

/** @param {string} resultKey */
function finish(resultKey) {
  const result = fixtures.results[resultKey];
  sendCallback('processResult', { action: 'launch', ...result });
  closeView();
  const code = readString(result.errorCode);
  state.endedStatus = `${result.status}${code === null ? '' : ` (${code})`}`;
  state.phase = 'ended';
  state.notice = null;
  state.busy = false;
}

// Returns the HTTP status of GET /mock/api/ping, or 0 when the mock is unreachable.
async function pingSession() {
  try {
    const response = await fetch('/mock/api/ping', {
      headers: { Authorization: `Bearer ${state.sessionToken}` }
    });
    return response.status;
  } catch {
    return 0;
  }
}

async function openSearchAfterValidation() {
  const status = await pingSession();
  if (state.phase !== 'journey') {
    return;
  }
  if (status === 401) {
    finish('sessionInvalid');
  } else {
    if (status !== 200) {
      state.notice = {
        text: `Could not validate the session (ping ${status}); continuing.`,
        pending: false,
        tone: 'info'
      };
    }
    enterStep('search');
  }
  notify();
}

/** @param {() => Promise<void>} task */
async function withBusy(task) {
  if (state.busy) {
    return;
  }
  state.busy = true;
  notify();
  try {
    await task();
  } catch (e) {
    state.notice = {
      text: `Error: ${e instanceof Error ? e.message : String(e)}`,
      pending: false,
      tone: 'error'
    };
  } finally {
    state.busy = false;
    notify();
  }
}

// ---------------------------------------------------------------------------
// Bridge hooks (see sdk/core.js)
// ---------------------------------------------------------------------------

/**
 * @param {LaunchRequest} request
 * @returns {SdkFlowResult}
 */
function launch(request) {
  state.requestId = request.requestId;
  state.service = request.service;

  if (request.sessionToken === null) {
    return {
      handled: true,
      events: EXIT_EVENTS,
      response: toSdkResponse(request.requestId, request.service, 'processResult', {
        action: 'launch',
        ...fixtures.results.sessionMissing
      })
    };
  }

  const products = loadProducts();
  Object.assign(state, {
    phase: 'journey',
    sessionToken: request.sessionToken,
    products,
    query: '',
    results: products,
    selected: null,
    quantity: 1,
    step: LOADING_STEP,
    notice: null,
    endedStatus: null,
    busy: false
  });
  notify();
  // Runs after the bridge has sent this launch's response and render events.
  void openSearchAfterValidation();

  return {
    handled: true,
    events: RENDER_EVENTS,
    response: toSdkResponse(request.requestId, request.service, 'eventStream', {
      action: 'launch',
      event: 'ProcessStarted'
    })
  };
}

// Shared by the native back button and the page's back arrow.
function goBack() {
  if (state.step <= STEP.search) {
    finish('backPressed');
  } else if (state.step === STEP.done) {
    // The order is already placed; leaving now is a completed journey.
    finish('completed');
  } else {
    state.step -= 1;
    state.notice = null;
  }
}

/** @returns {SdkFlowResult} */
function backPress() {
  if (state.phase !== 'journey') {
    return { handled: true, events: EXIT_EVENTS, response: null };
  }
  if (!state.busy) {
    goBack();
    notify();
  }
  return { handled: true, events: [], response: null };
}

function terminate() {
  Object.assign(state, {
    phase: 'waiting',
    sessionToken: null,
    notice: null,
    endedStatus: null,
    busy: false
  });
  notify();
}

export const journeyHooks = { launch, backPress, terminate };

// ---------------------------------------------------------------------------
// Shopper actions
// ---------------------------------------------------------------------------

/** @param {StepKey} key */
function canActOn(key) {
  return state.phase === 'journey' && !state.busy && state.step === STEP[key];
}

/** @param {string} query Empty shows the whole catalog. */
export function search(query) {
  if (!canActOn('search')) {
    return;
  }
  const needle = query.trim().toLowerCase();
  state.query = query.trim();
  state.results = state.products.filter((product) => product.name.toLowerCase().includes(needle));
  enterStep('search');
  notify();
}

/** @param {Product} product */
export function openProduct(product) {
  if (!canActOn('search')) {
    return;
  }
  state.selected = product;
  state.quantity = 1;
  enterStep('product');
  notify();
}

/** @param {number} delta */
export function changeQuantity(delta) {
  if (!canActOn('product')) {
    return;
  }
  state.quantity = Math.min(MAX_QUANTITY, Math.max(1, state.quantity + delta));
  notify();
}

/**
 * @param {StepKey} from
 * @param {StepKey} to
 */
function advance(from, to) {
  if (!canActOn(from) || state.selected === null) {
    return;
  }
  state.notice = null;
  enterStep(to);
  notify();
}

export const addToCart = () => advance('product', 'cart');
export const checkout = () => advance('cart', 'checkout');
export const continueToAddress = () => advance('checkout', 'address');
export const deliverHere = () => advance('address', 'confirm');
export const proceedToPay = () => advance('confirm', 'pay');

export function pay() {
  if (!canActOn('pay') || state.selected === null) {
    return;
  }
  void withBusy(async () => {
    setNotice('Waiting for your app to verify the payment (runSca)…', { pending: true });
    const result = await invokeNativeMethod({
      methodName: 'runSca',
      params: { ...fixtures.sca.runSca, amount: cartTotal().wire },
      timeout: INVOKE_TIMEOUT_MS
    });

    if (isJSON(result) && result.status === 'failed') {
      state.notice = {
        text: `Payment verification failed: ${redact(result)}`,
        pending: false,
        tone: 'error'
      };
      return;
    }
    state.notice = {
      text: isJSON(result)
        ? `Payment verified: ${redact(result)}`
        : `No SCA result from your app (${redact(result)}); continuing.`,
      pending: false,
      tone: 'info'
    };
    enterStep('done');
  });
}

export function complete() {
  if (!canActOn('done')) {
    return;
  }
  finish('completed');
  notify();
}

export function back() {
  if (state.phase === 'journey' && !state.busy) {
    goBack();
    notify();
  }
}

export function close() {
  if (state.phase === 'journey' && !state.busy) {
    finish('cancelled');
    notify();
  } else if (state.phase !== 'journey') {
    closeView();
  }
}

export function fail() {
  if (state.phase !== 'journey' || state.busy) {
    return;
  }
  finish('failed');
  notify();
}

export function expireSession() {
  if (state.phase !== 'journey' || state.busy) {
    return;
  }
  void withBusy(async () => {
    setNotice('Revoking the session on Mock Commerce…', { pending: true });
    await fetch('/mock/revoke', { method: 'POST' });
    const before = await pingSession();
    if (before !== 401) {
      state.notice = {
        text: `Expected ping 401 after revoke, got ${before}.`,
        pending: false,
        tone: 'error'
      };
      return;
    }

    setNotice('Session expired (ping 401, as expected). Asking your app for a new session…', {
      pending: true
    });
    const result = await invokeNativeMethod({
      methodName: 'refreshSession',
      params: fixtures.session.refreshSession,
      timeout: INVOKE_TIMEOUT_MS
    });
    const sessionToken = isJSON(result) ? readString(result.sessionToken) : null;
    if (sessionToken === null) {
      state.notice = {
        text: `Your app returned no session token (${redact(result)}).`,
        pending: false,
        tone: 'error'
      };
      return;
    }

    state.sessionToken = sessionToken;
    const after = await pingSession();
    state.notice =
      after === 200
        ? { text: 'Session refreshed.', pending: false, tone: 'info' }
        : {
            text: `Refreshed session was rejected (ping ${after}).`,
            pending: false,
            tone: 'error'
          };
  });
}
