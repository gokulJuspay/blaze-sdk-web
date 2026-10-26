// @ts-check
// Wire payload fixtures served from examples/mock-commerce/fixtures (seed for S68.1).

/**
 * @typedef {object} Fixtures
 * @property {Record<string, { event: string, eventData: Record<string, unknown> }>} events
 * @property {Record<string, Record<string, unknown>>} results
 * @property {{ runSca: Record<string, unknown> }} sca
 * @property {{ refreshSession: Record<string, unknown> }} session
 */

/** @type {Fixtures} */
export const fixtures = {
  events: {},
  results: {},
  sca: { runSca: {} },
  session: { refreshSession: {} }
};

/** @param {keyof Fixtures} name */
async function loadFixture(name) {
  const response = await fetch(`/sdk/fixtures/${name}.json`);
  if (!response.ok) {
    throw new Error(`fixture ${name} -> ${response.status}`);
  }
  fixtures[name] = await response.json();
}

export async function loadFixtures() {
  await Promise.all(
    /** @type {(keyof Fixtures)[]} */ (['events', 'results', 'sca', 'session']).map(loadFixture)
  );
}
