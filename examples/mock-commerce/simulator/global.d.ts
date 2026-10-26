// Bridge globals the native SDKs inject or call (same as ostia src/global.d.ts). Type-check only;
// not served.

declare global {
  interface Window {
    Native?: { onEvent?: (message: string) => void };
    webkit?: { messageHandlers?: { Native?: { postMessage?: (message: string) => void } } };
    onSDKEvent?: (raw: unknown) => void;
  }
}

export {};
