import type { AppUser } from '~/types'

export default defineNuxtPlugin((nuxtApp) => {
  const sessionUser = useSessionUser()
  if (nuxtApp.ssrContext?.event.context.appUser) {
    sessionUser.value = nuxtApp.ssrContext.event.context.appUser as AppUser
  }
})
