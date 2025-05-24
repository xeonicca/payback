export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  devtools: { enabled: true },

  modules: [
    '@nuxt/eslint',
    '@nuxt/fonts',
    '@nuxt/icon',
    '@nuxt/image',
    'nuxt-vuefire',
    '@nuxtjs/tailwindcss',
  ],

  runtimeConfig: {
    public: {
      firebase: {
        apiKey: '',
        authDomain: '',
        projectId: '',
        appId: '',
        storageBucket: '',
        messagingSenderId: '',
        authCookieName: '',
        authCookieExpires: '',
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
      authDomain: process.env.NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NUXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId: process.env.NUXT_PUBLIC_FIREBASE_APP_ID,
      storageBucket: process.env.NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    },
  },
})
