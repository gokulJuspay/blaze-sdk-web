// @ts-check
// Website-style screens modelled on ostia's shop pages: search results grid (ProductCard),
// product detail (product-detail.svelte), cart drawer (forklift CartDrawer), checkout and order
// summary (ucp-checkout.svelte). Mock-only test tools sit behind the header's "Mock" pill.

import { formatPrice } from '../catalog/store.js';
import { button, byId, element, externalLink, productImage } from '../dom.js';
import { setBridgeLogger } from '../sdk/log.js';
import { redact } from '../utils.js';
import {
  ADDRESS_LINE,
  LOADING_STEP,
  MAX_QUANTITY,
  ORDER_ID,
  STEP,
  addToCart,
  back,
  cartTotal,
  changeQuantity,
  checkout,
  close,
  complete,
  continueToAddress,
  deliverHere,
  expireSession,
  fail,
  openProduct,
  pay,
  proceedToPay,
  search,
  subscribe
} from './store.js';

/** @typedef {import('../types.js').Product} Product */
/** @typedef {import('./store.js').JourneyState} JourneyState */

const MAX_LOG_LINES = 200;
const DASHBOARD_PATH = '/sdk/dashboard';
const VENDOR_LABEL = 'Test catalog';
const SKELETON_CARDS = 4;

/**
 * @typedef {object} JourneyUiOptions
 * @property {boolean} standalone
 * @property {() => void} onStartDemo
 */

/** @type {JourneyUiOptions} */
let options = { standalone: false, onStartDemo: () => {} };
// The search field keeps focus and caret across re-renders.
let searchDraft = '';

/**
 * @param {string} src
 * @param {string} className
 */
function icon(src, className) {
  const image = element('img', { className });
  image.src = src;
  image.alt = '';
  return image;
}

/**
 * @param {string} label
 * @param {() => void} onclick
 * @param {boolean} disabled
 */
function primaryButton(label, onclick, disabled) {
  return button(label, 'primary-button', onclick, disabled);
}

/** @param {HTMLElement[]} children */
function actionBar(children) {
  return element('div', { className: 'action-bar' }, children);
}

/**
 * @param {string} label
 * @param {string} value
 * @param {boolean} [final]
 */
function totalRow(label, value, final = false) {
  return element('div', { className: final ? 'total-row total-final' : 'total-row' }, [
    element('span', { text: label }),
    element('span', { text: value })
  ]);
}

/** @param {JourneyState} state */
function lineItem(state) {
  const product = /** @type {Product} */ (state.selected);
  return element('div', { className: 'line-item' }, [
    productImage(product, 'line-image'),
    element('div', { className: 'line-info' }, [
      element('span', { className: 'line-title', text: product.name }),
      element('span', { className: 'line-qty', text: `Qty ${state.quantity}` })
    ]),
    element('span', { className: 'line-price', text: formatPrice(cartTotal().rupees) })
  ]);
}

/**
 * @param {string} title
 * @param {(HTMLElement | string)[]} children
 */
function section(title, children) {
  return element('section', { className: 'section' }, [
    element('h2', { className: 'section-title', text: title }),
    ...children
  ]);
}

/**
 * @param {string} title
 * @param {string} detail
 */
function selectedOption(title, detail) {
  return element('div', { className: 'option-card selected' }, [
    element('span', { className: 'radio' }),
    element('div', { className: 'option-text' }, [
      element('span', { className: 'option-title', text: title }),
      element('span', { className: 'option-detail', text: detail })
    ])
  ]);
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

/**
 * ostia ProductCard.
 * @param {Product} product
 * @param {boolean} disabled
 */
function productCard(product, disabled) {
  const card = button('', 'product-card', () => openProduct(product), disabled);
  card.setAttribute('aria-label', `${product.name}, ${formatPrice(product.price)}`);
  card.append(
    productImage(product, 'card-image'),
    element('div', { className: 'card-info' }, [
      element('p', { className: 'card-vendor', text: VENDOR_LABEL }),
      element('p', { className: 'card-title', text: product.name }),
      element('p', { className: 'card-price', text: formatPrice(product.price) })
    ])
  );
  return card;
}

/** @param {JourneyState} state */
function searchForm(state) {
  const input = element('input', { className: 'search-input' });
  input.type = 'search';
  input.id = 'search-input';
  input.placeholder = 'Search your test catalog';
  input.value = searchDraft;
  input.disabled = state.busy;
  input.setAttribute('aria-label', 'Search products');
  input.addEventListener('input', () => {
    searchDraft = input.value;
  });

  const form = element('form', { className: 'search-form' }, [
    icon('/sdk/assets/icon-search.svg', 'search-icon'),
    input,
    element('span', { className: 'sparkle' }, [icon('/sdk/assets/icon-ai-sparkle.svg', '')])
  ]);
  form.setAttribute('role', 'search');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    search(searchDraft);
  });
  return form;
}

/** @param {JourneyState} state */
function searchScreen(state) {
  /** @type {HTMLElement[]} */
  const children = [searchForm(state)];

  if (state.products.length === 0) {
    children.push(
      element('div', { className: 'empty-state' }, [
        element('p', { className: 'empty-text', text: 'Your test catalog is empty.' }),
        dashboardLink('Add products in the merchant dashboard')
      ])
    );
    return children;
  }

  const count = element('p', { className: 'results-count' });
  if (state.query === '') {
    const total = state.results.length;
    count.textContent = `${total} product${total === 1 ? '' : 's'} in your test catalog`;
  } else if (state.results.length > 0) {
    count.append(
      `${state.results.length} result${state.results.length === 1 ? '' : 's'} for `,
      element('strong', { text: `"${state.query}"` })
    );
  } else {
    count.append('No results found for ', element('strong', { text: `"${state.query}"` }));
  }
  children.push(count);

  if (state.results.length === 0) {
    const showAll = button('Show all products', 'text-button', () => {
      searchDraft = '';
      search('');
    });
    children.push(
      element('div', { className: 'empty-state' }, [
        element('p', {
          className: 'empty-text',
          text: 'No products found. Try a different search term.'
        }),
        showAll
      ])
    );
  } else {
    children.push(
      element(
        'div',
        { className: 'results-grid' },
        state.results.map((product) => productCard(product, state.busy))
      )
    );
  }
  return children;
}

/**
 * @param {JourneyState} state
 * @param {boolean} withActions False under the cart drawer, which has its own button.
 */
function productScreen(state, withActions) {
  const product = /** @type {Product} */ (state.selected);
  const info = element('div', { className: 'product-info' }, [
    element('p', { className: 'shop-link', text: VENDOR_LABEL }),
    element('h1', { className: 'product-title', text: product.name }),
    element('p', { className: 'product-price', text: formatPrice(product.price) }),
    element('span', { className: 'pill-success', text: 'In Stock' }),
    element('div', { className: 'quantity-section' }, [
      element('span', { className: 'quantity-label', text: 'Quantity' }),
      element('div', { className: 'quantity-selector' }, [
        quantityButton('−', 'Decrease quantity', -1, state.quantity <= 1 || state.busy),
        element('span', { className: 'quantity-value', text: String(state.quantity) }),
        quantityButton('+', 'Increase quantity', 1, state.quantity >= MAX_QUANTITY || state.busy)
      ])
    ])
  ]);
  if (product.productUrl !== null) {
    info.append(externalLink(product.productUrl, 'View on merchant site', 'text-link'));
  }

  const page = [productImage(product, 'image-gallery'), info];
  if (withActions) {
    page.push(actionBar([primaryButton('Add to Cart', addToCart, state.busy)]));
  }
  return page;
}

/**
 * @param {string} label
 * @param {string} ariaLabel
 * @param {number} delta
 * @param {boolean} disabled
 */
function quantityButton(label, ariaLabel, delta, disabled) {
  const node = button(label, 'quantity-button', () => changeQuantity(delta), disabled);
  node.setAttribute('aria-label', ariaLabel);
  return node;
}

/** ostia's Add to Cart opens forklift's CartDrawer over the product page. */
/** @param {JourneyState} state */
function cartDrawer(state) {
  const closeButton = button('', 'icon-button', back, state.busy);
  closeButton.setAttribute('aria-label', 'Close cart');
  closeButton.append(icon('/sdk/assets/icon-close.svg', 'icon-small'));

  const drawer = element('div', { className: 'drawer' }, [
    element('div', { className: 'drawer-header' }, [
      element('h2', { className: 'drawer-title', text: 'Your cart' }),
      closeButton
    ]),
    lineItem(state),
    element('div', { className: 'totals' }, [
      totalRow('Subtotal', formatPrice(cartTotal().rupees), true)
    ]),
    primaryButton('Checkout', checkout, state.busy)
  ]);
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', 'Cart');
  return element('div', { className: 'drawer-overlay' }, [drawer]);
}

/** @param {JourneyState} state */
function checkoutScreen(state) {
  return [
    element('h1', { className: 'page-title', text: 'Checkout' }),
    section('Contact', [
      element('p', { className: 'detail-line', text: 'Demo Shopper' }),
      element('p', { className: 'detail-muted', text: 'demo@breeze.test · +91 98765 43210' })
    ]),
    section('Your order', [lineItem(state)]),
    actionBar([primaryButton('Continue to address', continueToAddress, state.busy)])
  ];
}

/** @param {JourneyState} state */
function addressScreen(state) {
  return [
    element('h1', { className: 'page-title', text: 'Delivery address' }),
    selectedOption('Home', ADDRESS_LINE),
    actionBar([primaryButton('Deliver here', deliverHere, state.busy)])
  ];
}

/** @param {JourneyState} state */
function orderSummary(state) {
  const total = formatPrice(cartTotal().rupees);
  return [
    element('section', { className: 'line-items' }, [lineItem(state)]),
    element('section', { className: 'totals' }, [
      totalRow('Subtotal', total),
      totalRow('Shipping', 'Free'),
      totalRow('Total', total, true)
    ])
  ];
}

/** @param {JourneyState} state */
function confirmScreen(state) {
  return [
    element('header', { className: 'summary-header' }, [
      element('h1', { className: 'page-title', text: 'Order summary' }),
      element('p', { className: 'detail-muted', text: `Deliver to ${ADDRESS_LINE}` })
    ]),
    ...orderSummary(state),
    actionBar([primaryButton('Proceed to pay', proceedToPay, state.busy)])
  ];
}

/** @param {JourneyState} state */
function payScreen(state) {
  const total = formatPrice(cartTotal().rupees);
  return [
    element('h1', { className: 'page-title', text: 'Payment' }),
    element('p', { className: 'pay-amount', text: total }),
    selectedOption('Card ending 4242', 'Visa · Demo card'),
    actionBar([primaryButton(state.busy ? 'Verifying…' : `Pay ${total}`, pay, state.busy)])
  ];
}

/** @param {JourneyState} state */
function doneScreen(state) {
  return [
    element('div', { className: 'success' }, [
      icon('/sdk/assets/icon-success.svg', 'success-icon'),
      element('h1', { className: 'page-title', text: 'Order placed' }),
      element('p', { className: 'detail-muted', text: `Order ${ORDER_ID}` })
    ]),
    ...orderSummary(state),
    actionBar([primaryButton('Done', complete, state.busy)])
  ];
}

function loadingScreen() {
  return [
    element(
      'div',
      { className: 'results-grid' },
      Array.from({ length: SKELETON_CARDS }, () => element('div', { className: 'skeleton-card' }))
    )
  ];
}

/** @param {string} label */
function dashboardLink(label) {
  const link = element('a', { className: 'text-link', text: label });
  link.href = DASHBOARD_PATH;
  return link;
}

/** @param {JourneyState} state */
function waitingScreen(state) {
  /** @type {HTMLElement[]} */
  const children = [
    element('p', { className: 'empty-text', text: 'Waiting for your app to launch' }),
    element('p', {
      className: 'detail-muted',
      text: "initiate → process { action: 'launch' } from the native SDK"
    })
  ];
  if (options.standalone) {
    children.push(
      primaryButton('Start demo journey', options.onStartDemo, state.busy),
      dashboardLink('Manage test products')
    );
  }
  return [element('div', { className: 'empty-state' }, children)];
}

/** @param {JourneyState} state */
function endedScreen(state) {
  /** @type {HTMLElement[]} */
  const children = [
    element('p', { className: 'empty-text', text: `Journey ended: ${state.endedStatus ?? ''}` }),
    element('p', {
      className: 'detail-muted',
      text: 'processResult sent, then hideView + releaseBackPress.'
    })
  ];
  if (options.standalone) {
    children.push(
      primaryButton('Start again', options.onStartDemo, state.busy),
      dashboardLink('Manage test products')
    );
  }
  return [element('div', { className: 'empty-state' }, children)];
}

/**
 * @param {JourneyState} state
 * @returns {HTMLElement[]}
 */
function screenFor(state) {
  if (state.phase === 'waiting') {
    return waitingScreen(state);
  }
  if (state.phase === 'ended') {
    return endedScreen(state);
  }
  switch (state.step) {
    case LOADING_STEP:
      return loadingScreen();
    case STEP.search:
      return searchScreen(state);
    case STEP.product:
      return productScreen(state, true);
    case STEP.cart:
      return [...productScreen(state, false), cartDrawer(state)];
    case STEP.checkout:
      return checkoutScreen(state);
    case STEP.address:
      return addressScreen(state);
    case STEP.confirm:
      return confirmScreen(state);
    case STEP.pay:
      return payScreen(state);
    case STEP.done:
      return doneScreen(state);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/** @param {JourneyState} state */
function renderNotice(state) {
  const notice = byId('notice');
  notice.hidden = state.notice === null;
  if (state.notice === null) {
    notice.replaceChildren();
    return;
  }
  notice.className = `notice ${state.notice.tone}`;
  notice.replaceChildren(
    ...(state.notice.pending ? [element('span', { className: 'spinner' })] : []),
    element('span', { text: state.notice.text })
  );
}

/** @param {JourneyState} state */
function render(state) {
  const inJourney = state.phase === 'journey';
  const focusedSearch = document.activeElement?.id === 'search-input';

  /** @type {HTMLButtonElement} */ (byId('back')).hidden = !inJourney || state.step <= STEP.search;
  /** @type {HTMLButtonElement} */ (byId('back')).disabled = state.busy;
  const badge = byId('cart-badge');
  const hasCart = inJourney && state.step >= STEP.cart && state.selected !== null;
  badge.hidden = !hasCart;
  badge.textContent = String(state.quantity);

  for (const id of ['tool-fail', 'tool-expire']) {
    /** @type {HTMLButtonElement} */ (byId(id)).disabled = !inJourney || state.busy;
  }
  renderNotice(state);

  const screen = byId('screen');
  const stepChanged =
    screen.dataset.step !== String(state.step) || screen.dataset.phase !== state.phase;
  screen.replaceChildren(...screenFor(state));
  screen.dataset.step = String(state.step);
  screen.dataset.phase = state.phase;
  if (stepChanged) {
    window.scrollTo({ top: 0 });
  }
  if (focusedSearch) {
    /** @type {HTMLInputElement | null} */ (document.getElementById('search-input'))?.focus();
  }
}

/**
 * @param {'out' | 'in'} direction
 * @param {string} eventName
 * @param {unknown} payload
 */
function appendLog(direction, eventName, payload) {
  const time = new Date().toISOString().slice(11, 23);
  const arrow = direction === 'out' ? '->' : '<-';
  const detail = payload === undefined || payload === null ? '' : ` ${redact(payload)}`;
  const log = byId('log');
  const lines = `${time} ${arrow} ${eventName}${detail}\n${log.textContent ?? ''}`.split('\n');
  log.textContent = lines.slice(0, MAX_LOG_LINES).join('\n');
}

function toggleTools() {
  const tools = byId('tools');
  tools.hidden = !tools.hidden;
  byId('tools-toggle').setAttribute('aria-expanded', String(!tools.hidden));
}

/** @param {JourneyUiOptions} uiOptions */
export function mountJourneyUi(uiOptions) {
  options = uiOptions;
  setBridgeLogger(appendLog);

  byId('back').addEventListener('click', back);
  byId('close').addEventListener('click', close);
  byId('tools-toggle').addEventListener('click', toggleTools);
  byId('tool-fail').addEventListener('click', fail);
  byId('tool-expire').addEventListener('click', expireSession);

  subscribe(render);
}
