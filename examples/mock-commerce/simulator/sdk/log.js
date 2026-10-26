// @ts-check
// Bridge traffic hook for the simulator's "Bridge log" panel.

/** @typedef {import('../types.js').BridgeLogger} BridgeLogger */
/** @typedef {import('../types.js').BridgeDirection} BridgeDirection */

/** @type {BridgeLogger | null} */
let logger = null;

/** @param {BridgeLogger | null} next */
export function setBridgeLogger(next) {
  logger = next;
}

/**
 * @param {BridgeDirection} direction
 * @param {string} eventName
 * @param {unknown} payload
 */
export function logBridge(direction, eventName, payload) {
  logger?.(direction, eventName, payload);
}
