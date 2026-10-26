// @ts-check

/** @typedef {import('./types.js').Product} Product */

const PLACEHOLDER_ICON = '/sdk/assets/icon-image-placeholder.svg';

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
export function byId(id) {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Missing #${id}`);
  }
  return node;
}

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {{ className?: string, text?: string }} [options]
 * @param {(Node | string)[]} [children]
 * @returns {HTMLElementTagNameMap[K]}
 */
export function element(tag, { className, text } = {}, children = []) {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  node.append(...children);
  return node;
}

/**
 * @param {string} label
 * @param {string} className
 * @param {() => void} onclick
 * @param {boolean} [disabled]
 */
export function button(label, className, onclick, disabled = false) {
  const node = element('button', { className, text: label });
  node.type = 'button';
  node.disabled = disabled;
  node.addEventListener('click', onclick);
  return node;
}

/**
 * @param {string} href
 * @param {string} label
 * @param {string} className
 */
export function externalLink(href, label, className) {
  const node = element('a', { className, text: label });
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

/**
 * Product image with ostia's placeholder icon when there is no image or it fails to load.
 * @param {Product} product
 * @param {string} className
 */
export function productImage(product, className) {
  const frame = element('div', { className });
  const image = element('img');
  image.alt = product.name;
  image.loading = 'lazy';

  const showPlaceholder = () => {
    image.src = PLACEHOLDER_ICON;
    image.alt = '';
    image.className = 'placeholder-icon';
  };
  if (product.imageUrl === null) {
    showPlaceholder();
  } else {
    image.src = product.imageUrl;
    image.addEventListener('error', showPlaceholder, { once: true });
  }
  frame.append(image);
  return frame;
}
