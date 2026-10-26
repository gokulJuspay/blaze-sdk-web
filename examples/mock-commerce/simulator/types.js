// Shared JSDoc types for the simulator and dashboard (mirrors ostia sdk/types.ts, chat/types.ts).

/**
 * @typedef {object} Product
 * @property {string} id
 * @property {string} name
 * @property {number} price Rupees.
 * @property {string | null} imageUrl
 * @property {string | null} productUrl
 */

/**
 * @typedef {object} SdkResponse
 * @property {string} requestId
 * @property {string} service
 * @property {Record<string, unknown>} payload
 */

/** @typedef {{ eventName: string, payload: Record<string, unknown> | null }} SdkFlowEvent */

/** @typedef {{ handled: boolean, response: SdkResponse | null, events: SdkFlowEvent[] }} SdkFlowResult */

/** @typedef {{ requestId: string, service: string, sessionToken: string | null }} LaunchRequest */

/**
 * @typedef {object} JourneyHooks
 * @property {(request: LaunchRequest) => SdkFlowResult} launch
 * @property {() => SdkFlowResult} backPress
 * @property {() => void} terminate
 */

/** @typedef {(message: string) => void} Postman */

/** @typedef {{ methodName: string, params: Record<string, unknown>, timeout?: number }} NativeInvokeParams */

/** @typedef {'out' | 'in'} BridgeDirection */

/** @typedef {(direction: BridgeDirection, eventName: string, payload: unknown) => void} BridgeLogger */

/** @typedef {'search' | 'product' | 'cart' | 'checkout' | 'address' | 'confirm' | 'pay' | 'done'} StepKey */

/**
 * Status banner for native round trips (runSca, refreshSession) and session checks.
 * @typedef {object} Notice
 * @property {string} text
 * @property {boolean} pending Shows a spinner while waiting.
 * @property {'info' | 'error'} tone
 */

/** @typedef {'waiting' | 'journey' | 'ended'} JourneyPhase */

export {};
