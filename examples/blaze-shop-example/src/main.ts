import('./style.css');

type Settings = { frameUrl: string; initiate: string; process: string };

const STORAGE_KEY = 'blaze-shop-example';

const frameUrlPreset = document.getElementById('frame-url-preset') as HTMLSelectElement;
const frameUrlInput = document.getElementById('frame-url') as HTMLInputElement;
const initiateEditor = document.getElementById('initiate-payload') as HTMLTextAreaElement;
const processEditor = document.getElementById('process-payload') as HTMLTextAreaElement;
const errorText = document.getElementById('error') as HTMLParagraphElement;
const logView = document.getElementById('log') as HTMLPreElement;
const journey = document.getElementById('journey') as HTMLDivElement;

let iframe: HTMLIFrameElement | null = null;
let frameOrigin = '';
let ready = false;
let queue: string[] = [];

function createSDKPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    requestId: crypto.randomUUID(),
    service: 'in.breeze.shop',
    payload
  };
}

function createInitiatePayload(): Record<string, unknown> {
  return {
    action: 'initiate',
    publisherId: 'demo'
  };
}

function createProcessPayload(): Record<string, unknown> {
  return {
    action: 'launch'
  };
}

function defaultSettings(): Settings {
  return {
    frameUrl: frameUrlPreset.options[0].value,
    initiate: JSON.stringify(createSDKPayload(createInitiatePayload()), null, 2),
    process: JSON.stringify(createSDKPayload(createProcessPayload()), null, 2)
  };
}

function loadSettings(): Settings {
  try {
    return { ...defaultSettings(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return defaultSettings();
  }
}

function applySettings(settings: Settings): void {
  frameUrlInput.value = settings.frameUrl;
  initiateEditor.value = settings.initiate;
  processEditor.value = settings.process;
  syncPreset();
}

function saveSettings(): void {
  const settings: Settings = {
    frameUrl: frameUrlInput.value.trim(),
    initiate: initiateEditor.value,
    process: processEditor.value
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function syncPreset(): void {
  const preset = Array.from(frameUrlPreset.options).find(
    (option) => option.value === frameUrlInput.value.trim()
  );
  frameUrlPreset.value = preset?.value ?? '';
}

function log(direction: string, eventName: string, eventData: unknown): void {
  const time = new Date().toLocaleTimeString();
  const data =
    eventData === null || eventData === undefined ? '' : JSON.stringify(eventData, null, 2);
  logView.textContent = `${time} ${direction} ${eventName}\n${data}\n\n` + logView.textContent;
}

function showError(message: string | null): void {
  errorText.textContent = message;
  errorText.hidden = message === null;
}

function readPayload(editor: HTMLTextAreaElement): unknown {
  try {
    showError(null);
    return JSON.parse(editor.value);
  } catch (error) {
    showError(`${editor.labels?.[0]?.textContent}: ${(error as Error).message}`);
    return null;
  }
}

function readFrameUrl(): string | null {
  const frameUrl = frameUrlInput.value.trim();
  if (!URL.canParse(frameUrl)) {
    showError(`Frame URL: "${frameUrl}" is not a valid URL`);
    return null;
  }
  return frameUrl;
}

function setJourneyOpen(open: boolean): void {
  journey.classList.toggle('open', open);
  document.body.style.overflow = open ? 'hidden' : '';
}

function send(eventName: string, eventData: unknown): void {
  const message = JSON.stringify({ source: 'blaze', eventName, eventData });
  log('→', eventName, eventData);
  if (ready && iframe?.contentWindow) {
    iframe.contentWindow.postMessage(message, frameOrigin);
  } else {
    queue.push(message);
  }
}

function mount(frameUrl: string): void {
  frameOrigin = new URL(frameUrl).origin;
  iframe = document.createElement('iframe');
  iframe.src = frameUrl;
  iframe.title = 'Breeze shop';
  journey.replaceChildren(iframe);
  journey.hidden = false;
}

function onMessage(event: MessageEvent): void {
  if (iframe === null || event.source !== iframe.contentWindow || event.origin !== frameOrigin) {
    return;
  }
  const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  if (message?.source !== 'breeze') {
    return;
  }
  const eventData =
    typeof message.eventData === 'string' ? JSON.parse(message.eventData) : message.eventData;
  log('←', message.eventName, eventData);

  switch (message.eventName) {
    case 'app-ready':
      ready = true;
      queue.forEach((queued) => iframe?.contentWindow?.postMessage(queued, frameOrigin));
      queue = [];
      break;
    case 'renderView':
      setJourneyOpen(true);
      break;
    case 'hideView':
      setJourneyOpen(false);
      break;
  }
}

function initiateSDK(): void {
  const frameUrl = readFrameUrl();
  const payload = frameUrl === null ? null : readPayload(initiateEditor);
  if (frameUrl === null || payload === null) {
    return;
  }
  terminateSDK();
  mount(frameUrl);
  send('initiate', payload);
}

function processSDK(): void {
  const payload = readPayload(processEditor);
  if (payload === null) {
    return;
  }
  send('process', payload);
}

function terminateSDK(): void {
  if (ready) {
    send('terminate', {});
  }
  setJourneyOpen(false);
  journey.replaceChildren();
  journey.hidden = true;
  iframe = null;
  ready = false;
  queue = [];
}

function resetPayloads(): void {
  localStorage.removeItem(STORAGE_KEY);
  applySettings(defaultSettings());
  showError(null);
}

function selectPreset(): void {
  if (frameUrlPreset.value === '') {
    frameUrlInput.focus();
    return;
  }
  frameUrlInput.value = frameUrlPreset.value;
  saveSettings();
}

window.addEventListener('message', onMessage);
frameUrlPreset.addEventListener('change', selectPreset);
frameUrlInput.addEventListener('input', () => {
  syncPreset();
  saveSettings();
});
[initiateEditor, processEditor].forEach((editor) => editor.addEventListener('input', saveSettings));
document.getElementById('clear-log')?.addEventListener('click', () => (logView.textContent = ''));

window.initiateSDK = initiateSDK;
window.processSDK = processSDK;
window.terminateSDK = terminateSDK;
window.resetPayloads = resetPayloads;

applySettings(loadSettings());
