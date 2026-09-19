import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.payback.app',
  appName: 'Payback',
  // Nuxt SPA static output (`nuxt generate`)
  webDir: '.output/public',
  ios: {
    contentInset: 'always',
  },
  experimental: {
    ios: {
      spm: {
        packageOptions: {
          '@capacitor-firebase/authentication': { symlink: true },
        },
      },
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#314158',
      showSpinner: false,
    },
    FirebaseAuthentication: {
      // VueFire and Firestore share the Firebase JavaScript SDK identity.
      skipNativeAuth: true,
      providers: ['google.com'],
    },
  },
}

export default config
