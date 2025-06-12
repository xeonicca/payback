import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  devtools: { enabled: false },
  modules: [
    '@nuxt/eslint',
    '@nuxt/fonts',
    '@nuxt/icon',
    '@nuxt/image',
    'nuxt-vuefire',
    'shadcn-nuxt',
    // '@sentry/nuxt/module' // comment out for now until https://github.com/getsentry/sentry-javascript/pull/16444 is released
    '@vite-pwa/nuxt',
  ],

  app: {
    head: {
      title: 'Payback',
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
        { rel: 'apple-touch-icon', href: '/163.png' },
      ],
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, user-scalable=no, maximum-scale=1, viewport-fit=cover' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      ],
    },
  },

  css: ['~/assets/css/tailwind.css'],

  vite: {
    plugins: [
      tailwindcss(),
    ],
  },

  runtimeConfig: {
    public: {
      firebase: {
        apiKey: process.env.NUXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.VERCEL_URL,
        projectId: process.env.NUXT_PUBLIC_FIREBASE_PROJECT_ID,
        appId: process.env.NUXT_PUBLIC_FIREBASE_APP_ID,
        storageBucket: process.env.NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      },
    },
    authCookieName: process.env.NUXT_PUBLIC_FIREBASE_AUTH_COOKIE_NAME,
    authCookieExpires: process.env.NUXT_PUBLIC_FIREBASE_AUTH_COOKIE_EXPIRES,
    serviceAccount: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  },

  vuefire: {
    auth: true,
    config: {
      apiKey: process.env.NUXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.VERCEL_URL,
      projectId: process.env.NUXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId: process.env.NUXT_PUBLIC_FIREBASE_APP_ID,
      storageBucket: process.env.NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    },
  },

  shadcn: {
    /**
     * Prefix for all the imported component
     */
    prefix: 'ui',
    /**
     * Directory that the component lives in.
     * @default "./components/ui"
     */
    componentDir: './components/ui',
  },

  pwa: {
    strategies: 'generateSW',
    registerType: 'prompt',
    manifest: {
      name: 'Payback',
      short_name: 'Payback',
      description: 'Payback Travel Mate',
      theme_color: '#314158',
      background_color: '#314158',
      orientation: 'portrait',
      icons: [
        {
          src: '/192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: '/512.png',
          sizes: '512x512',
          type: 'image/png',
        },
        // {
        //   src: 'pwa-512x512.png',
        //   sizes: '512x512',
        //   type: 'image/png',
        //   purpose: 'any maskable',
        // },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      navigateFallback: '/login',
      navigateFallbackDenylist: [/^\/api/],
      cleanupOutdatedCaches: true,
      runtimeCaching: [
        {
          urlPattern: /\.(?:js|css)$/,
          handler: 'StaleWhileRevalidate',
          options: {
            cacheName: 'static-resources',
            expiration: {
              maxEntries: 60,
              maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
            },
          },
        },
        {
          urlPattern: /\.(?:png|svg|ico)$/,
          handler: 'CacheFirst',
          options: {
            cacheName: 'images',
            expiration: {
              maxEntries: 60,
              maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
            },
          },
        },
      ],
    },
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
    },
    client: {
      installPrompt: true,
      // you don't need to include this: only for testing purposes
      // if enabling periodic sync for update use 1 hour or so (periodicSyncForUpdates: 3600)
      periodicSyncForUpdates: 20,
    },
  },

  // sentry: {
  //   sourceMapsUploadOptions: {
  //     org: 'personal-projects-wv',
  //     project: 'payback-nuxt',
  //   },

  //   autoInjectServerSentry: 'top-level-import',
  // },

  sourcemap: {
    client: 'hidden',
  },
})
