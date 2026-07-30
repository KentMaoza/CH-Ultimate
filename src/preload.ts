import { contextBridge, ipcRenderer } from 'electron';

import { createChCoreBridge } from './electron/core-bridge-contract';

contextBridge.exposeInMainWorld(
  'chCore',
  createChCoreBridge((channel, input) => ipcRenderer.invoke(channel, input)),
);
