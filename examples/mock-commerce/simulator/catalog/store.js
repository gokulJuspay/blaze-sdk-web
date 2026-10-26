// @ts-check
// Merchant test catalog in localStorage, shared by the dashboard and the journey.
// A browser that has never saved a catalog starts with DEFAULT_PRODUCTS; once the merchant edits
// the list (including removing the default), that list is used as is, even when empty.
// Storage is per browser: a device WebView has its own, so it starts from DEFAULT_PRODUCTS.

/** @typedef {import('../types.js').Product} Product */

const STORAGE_KEY = 'blaze-mock:products';

/** @type {readonly Product[]} */
const DEFAULT_PRODUCTS = [
  { id: 'MOCK-SKU-1', name: 'Mock Runner 2', price: 4999, imageUrl: null, productUrl: null }
];

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isHttpUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {value is Product}
 */
function isProduct(value) {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const product = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof product.id === 'string' &&
    typeof product.name === 'string' &&
    product.name.length > 0 &&
    typeof product.price === 'number' &&
    product.price > 0 &&
    (product.imageUrl === null || isHttpUrl(product.imageUrl)) &&
    (product.productUrl === null || isHttpUrl(product.productUrl))
  );
}

// localStorage throws in some private modes; treat that as "nothing saved".
function readStorage() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** @returns {Product[]} */
export function loadProducts() {
  const raw = readStorage();
  if (raw === null) {
    return DEFAULT_PRODUCTS.map((product) => ({ ...product }));
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isProduct) : [];
  } catch {
    return [];
  }
}

/** @param {Product[]} products */
function saveProducts(products) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
}

export function resetProducts() {
  localStorage.removeItem(STORAGE_KEY);
}

// getRandomValues, not randomUUID: the latter is missing on plain-http LAN origins.
function generateProductId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `TEMP-${hex.toUpperCase()}`;
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function optionalUrl(value) {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Validates and appends a product. Throws an Error with a user-facing message when invalid.
 * @param {{ name: string, price: string, imageUrl: string, productUrl: string }} input
 * @returns {Product}
 */
export function addProduct(input) {
  const product = {
    id: generateProductId(),
    name: input.name.trim(),
    price: Number(input.price),
    imageUrl: optionalUrl(input.imageUrl),
    productUrl: optionalUrl(input.productUrl)
  };
  if (product.name === '') {
    throw new Error('Name is required');
  }
  if (!Number.isFinite(product.price) || product.price <= 0) {
    throw new Error('Price must be a number above 0');
  }
  if (product.imageUrl !== null && !isHttpUrl(product.imageUrl)) {
    throw new Error('Image URL must start with http:// or https://');
  }
  if (product.productUrl !== null && !isHttpUrl(product.productUrl)) {
    throw new Error('Product URL must start with http:// or https://');
  }
  saveProducts([...loadProducts(), product]);
  return product;
}

/** @param {string} id */
export function removeProduct(id) {
  saveProducts(loadProducts().filter((product) => product.id !== id));
}

/**
 * ₹1,299 for whole rupees, ₹349.50 otherwise.
 * @param {number} rupees
 */
export function formatPrice(rupees) {
  const digits = Number.isInteger(rupees) ? 0 : 2;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

/**
 * Wire payloads carry amounts in paise, like fixtures/events.json.
 * @param {number} rupees
 */
export function toMinorUnits(rupees) {
  return Math.round(rupees * 100);
}
