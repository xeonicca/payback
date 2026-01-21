export default defineNuxtPlugin(async () => {
  const { checkUser } = useLogin()
  const sessionUser = useSessionUser()

  const data = await checkUser()

  if (data)
    sessionUser.value = data

  // Return object so Nuxt waits for this plugin before running route middleware
  return {}
})
