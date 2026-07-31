import { _electron as electron } from '@playwright/test';

export function launchTestElectron() {
  return electron.launch({
    args: ['.vite/build/main.js'],
    env: {
      ...process.env,
      CH_ULTIMATE_E2E_TEST_MOCK: '1',
    },
  });
}
