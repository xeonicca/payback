export default defineNuxtPlugin(async () => {
  const { checkUser } = useLogin()
  const sessionUser = useSessionUser()

  const data = await checkUser()

  if (data)
    sessionUser.value = data
})
