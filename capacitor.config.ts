import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tokoch.chucompanion',
  appName: 'CHU Companion Mobile',
  webDir: 'dist-mobile',
  plugins: {
    SystemBars: {
      style: 'LIGHT',
      insetsHandling: 'css',
    },
  },
};

export default config;
