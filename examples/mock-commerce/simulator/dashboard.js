// @ts-check
// Merchant dashboard, served at /sdk/dashboard: manages the localStorage test catalog.

import {
  addProduct,
  formatPrice,
  loadProducts,
  removeProduct,
  resetProducts
} from './catalog/store.js';
import { button, byId, element, externalLink, productImage } from './dom.js';

/** @typedef {import('./types.js').Product} Product */

const JOURNEY_PATH = '/sdk?autostart=1';

/** @param {Product} product */
function productRow(product) {
  const details = element('p', { className: 'row-meta' }, [
    `${formatPrice(product.price)} · ${product.id}`
  ]);
  if (product.productUrl !== null) {
    details.append(externalLink(product.productUrl, 'Open', 'row-link'));
  }

  const remove = button('✕', 'remove-button', () => {
    removeProduct(product.id);
    renderProducts();
  });
  remove.setAttribute('aria-label', `Remove ${product.name}`);

  return element('li', { className: 'product-row' }, [
    productImage(product, 'row-image'),
    element('div', { className: 'row-info' }, [
      element('p', { className: 'row-name', text: product.name }),
      details
    ]),
    remove
  ]);
}

function renderProducts() {
  const products = loadProducts();
  byId('count').textContent = `(${products.length})`;
  byId('empty').hidden = products.length > 0;
  byId('products').replaceChildren(...products.map(productRow));
}

/**
 * @param {FormData} data
 * @param {string} field
 */
function readField(data, field) {
  const value = data.get(field);
  return typeof value === 'string' ? value : '';
}

/** @param {SubmitEvent} event */
function onSubmit(event) {
  event.preventDefault();
  const form = /** @type {HTMLFormElement} */ (event.currentTarget);
  const data = new FormData(form);
  try {
    addProduct({
      name: readField(data, 'name'),
      price: readField(data, 'price'),
      imageUrl: readField(data, 'imageUrl'),
      productUrl: readField(data, 'productUrl')
    });
    form.reset();
    byId('form-error').textContent = '';
    renderProducts();
  } catch (e) {
    byId('form-error').textContent = e instanceof Error ? e.message : String(e);
  }
}

byId('product-form').addEventListener('submit', onSubmit);
byId('reset').addEventListener('click', () => {
  resetProducts();
  renderProducts();
});
byId('start').addEventListener('click', () => {
  window.location.href = JOURNEY_PATH;
});

renderProducts();
