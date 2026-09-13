const allowedMethods = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']

export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/'))
    return
  setHeader(event, 'Vary', 'Origin')
  if (getHeader(event, 'origin') !== 'capacitor://localhost')
    return

  setHeader(event, 'Access-Control-Allow-Origin', 'capacitor://localhost')
  setHeader(event, 'Access-Control-Allow-Methods', allowedMethods.join(', '))
  setHeader(event, 'Access-Control-Allow-Headers', 'Authorization, Content-Type')
  setHeader(event, 'Access-Control-Max-Age', '600')

  if (event.method === 'OPTIONS') {
    const method = getHeader(event, 'access-control-request-method')
    if (!method || !allowedMethods.includes(method))
      throw createError({ statusCode: 403, statusMessage: 'Method not allowed' })
    setResponseStatus(event, 204)
    return ''
  }
})
