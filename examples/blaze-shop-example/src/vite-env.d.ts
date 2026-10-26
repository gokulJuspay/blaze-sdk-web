/// <reference types="vite/client" />

interface Window {
  initiateSDK: () => void;
  processSDK: () => void;
  terminateSDK: () => void;
  resetPayloads: () => void;
}
