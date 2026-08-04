declare module 'electron-squirrel-startup' {
  const started: boolean;
  export default started;
}

declare module '*.css';

interface Window {
  chCore?: import('./electron/core-bridge-contract').ChCoreBridge;
}

interface ImportMeta {
  readonly env: {
    readonly PROD: boolean;
  }
}
