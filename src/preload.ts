import { contextBridge, ipcRenderer } from 'electron';

import { createChCoreBridge } from './electron/core-bridge-contract';
import {
  createChOutputBridge,
  createE2eChOutputBridge,
} from './electron/output-contract';

contextBridge.exposeInMainWorld(
  'chCore',
  createChCoreBridge((channel, input) => ipcRenderer.invoke(channel, input)),
);

contextBridge.exposeInMainWorld(
  'chOutput',
  new URLSearchParams(globalThis.location.search).has('ch-ultimate-e2e-test-mock')
    ? createE2eChOutputBridge()
    : createChOutputBridge((channel, input) => ipcRenderer.invoke(channel, input)),
);
