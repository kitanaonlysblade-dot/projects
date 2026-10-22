import type { CapacitorConfig } from '@capacitor/cli';

// The app is the deployed Lumin website shown in a native shell ("remote URL" mode): every website update reaches the
// app at once, no store review needed for content changes. Set LUMIN_URL to your live website address before
// `npx cap sync` (for example https://app.yourdomain.com). The id below must be YOUR reverse-domain id and can never
// change after the first store upload.
const url = process.env.LUMIN_URL ?? 'https://CHANGE-ME.example.com';

const config: CapacitorConfig = {
  appId: process.env.LUMIN_APP_ID ?? 'com.example.lumin',
  appName: 'Lumin',
  webDir: 'www', // only the offline fallback page lives here
  server: {
    url,
    cleartext: false,
    // Pages that may load inside the app. Everything else opens in the phone's browser.
    allowNavigation: [new URL(url).hostname],
    errorPath: 'offline.html',
  },
  ios: { contentInset: 'always', limitsNavigationsToAppBoundDomains: false },
  android: { allowMixedContent: false },
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    SplashScreen: { launchShowDuration: 800, backgroundColor: '#ffffff' },
  },
};

export default config;
