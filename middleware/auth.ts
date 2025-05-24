export default defineNuxtRouteMiddleware(async (to) => {
  const { isUserLoggedIn } = useLogin()

  if (!isUserLoggedIn.value && to.path !== '/login') {
    return navigateTo({
      path: '/login',
      query: {
        redirect: to.fullPath,
      },
    })
  }
})
