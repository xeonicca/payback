import { sendRedirect } from 'h3'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, { event }) => {
    if (!event)
      return
    const status = (error as any).statusCode ?? (error as any).status
    // API callers (including the native app) need Nitro's JSON error response;
    // only browser page requests should be redirected to the login screen.
    if ((status === 401 || status === 403) && !event.path.startsWith('/api/')) {
      sendRedirect(event, '/login', 302)
    }
  })
})
