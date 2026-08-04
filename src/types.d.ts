declare module 'electron-squirrel-startup' {
  const started: boolean;
  export default started;
}

declare module '*.css';

interface Window {
  chCore?: import('./electron/core-bridge-contract').ChCoreBridge;
  chOutput?: import('./electron/output-contract').ChOutputBridge;
}

interface ImportMeta {
  readonly env: {
    readonly PROD: boolean;
  }
}
