// @ts-check

const REQUEST_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const REDACTED_KEYS = ['sessionToken', 'ott'];

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isJSON(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function readString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * @param {string} raw
 * @returns {Record<string, unknown> | null}
 */
export function safeParseJSON(raw) {
  try {
    const parsed = JSON.parse(raw);
    return isJSON(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Same 16-char alphanumeric shape as ostia's nanoid generateRequestId.
export function generateRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => REQUEST_ID_ALPHABET[byte % REQUEST_ID_ALPHABET.length]).join(
    ''
  );
}

/**
 * JSON for logs and notes, with tokens hidden.
 * @param {unknown} value
 */
export function redact(value) {
  return JSON.stringify(value, (key, inner) =>
    REDACTED_KEYS.includes(key) && inner !== null ? '<redacted>' : inner
  );
}
