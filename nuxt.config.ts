import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  devtools: { enabled: false },

  modules: ['@nuxt/eslint', '@nuxt/fonts', '@nuxt/icon', '@nuxt/image', 'nuxt-vuefire', 'shadcn-nuxt', '@vite-pwa/nuxt'],

  app: {
    head: {
      // link: [
      //   { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
      //   { rel: 'apple-touch-icon', href: '/images/app-icons/ios-app-icons-180x180.png' },
      // ],
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
      theme_color: '#171717',
      background_color: '#EBEBEB',
      icons: [
        {
          src: '/192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        // {
        //   src: 'pwa-512x512.png',
        //   sizes: '512x512',
        //   type: 'image/png',
        // },
        // {
        //   src: 'pwa-512x512.png',
        //   sizes: '512x512',
        //   type: 'image/png',
        //   purpose: 'any maskable',
        // },
      ],
    },
  },
})
