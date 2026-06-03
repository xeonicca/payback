import { sendRedirect } from 'h3'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, { event }) => {
    if (!event)
      return
    const status = (error as any).statusCode ?? (error as any).status
    if (status === 401 || status === 403) {
      sendRedirect(event, '/login', 302)
    }
  })
})
