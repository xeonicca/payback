import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
import { useFirebaseApp } from 'vuefire'

export default defineNuxtPlugin({
  name: 'firestore-persistence',
  enforce: 'pre',
  setup() {
    const app = useFirebaseApp()
    initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    })
  },
})
