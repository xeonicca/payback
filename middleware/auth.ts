export default defineNuxtRouteMiddleware(async (to) => {
  const { isUserLoggedIn } = useLogin()
  const sessionUser = useSessionUser()

  if (!isUserLoggedIn.value && to.path !== '/login') {
    return navigateTo({
      path: '/login',
      query: {
        redirect: to.fullPath,
      },
    })
  }

  // Anonymous guests visiting the trip list should be redirected to their trip
  if (sessionUser.value?.isAnonymous && to.path === '/') {
    const { useFirestore } = await import('vuefire')
    const { collection, getDocs, query, where } = await import('firebase/firestore')
    const db = useFirestore()
    const tripsQuery = query(
      collection(db, 'trips'),
      where('collaboratorUserIds', 'array-contains', sessionUser.value.uid),
    )
    const snapshot = await getDocs(tripsQuery)
    if (snapshot.size === 1) {
      return navigateTo(`/trips/${snapshot.docs[0].id}`)
    }
    else if (snapshot.size === 0) {
      return navigateTo('/login')
    }
    // If multiple trips (unlikely for guest), let them see the list
  }
})
