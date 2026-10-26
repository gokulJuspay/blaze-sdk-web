// @ts-check
// Journey simulator entry, served at /sdk. The WebView side of the Blaze bridge, mirroring ostia's
// /sdk route: wires the bridge to the journey, then announces appReady.

import { loadFixtures } from './journey/fixtures.js';
import { journeyHooks } from './journey/store.js';
import { mountJourneyUi } from './journey/ui.js';
import { emitAppReady, listen } from './sdk/bridge.js';
import { setJourneyHooks } from './sdk/core.js';
import { installStandaloneNative, isStandalone, startStandaloneJourney } from './sdk/standalone.js';

const AUTOSTART_PARAM = 'autostart';

/** @param {unknown} e */
function reportStartError(e) {
  console.error('[simulator] standalone start failed', e);
}

async function start() {
  // Native SDKs queue initiate/process until appReady, so fixtures must be loaded first.
  await loadFixtures();

  const standalone = isStandalone();
  if (standalone) {
    installStandaloneNative();
  }

  setJourneyHooks(journeyHooks);
  mountJourneyUi({
    standalone,
    onStartDemo: () => void startStandaloneJourney().catch(reportStartError)
  });
  listen();
  emitAppReady();

  // The dashboard's "Start journey" opens /sdk?autostart=1.
  if (standalone && new URLSearchParams(window.location.search).has(AUTOSTART_PARAM)) {
    await startStandaloneJourney();
  }
}

start().catch((e) => console.error('[simulator] failed to start', e));
