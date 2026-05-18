export default defineEventHandler(async (event) => {
  const body = await readBody<{ msg?: string, data?: unknown, ts?: string, sid?: string }>(event)
  // eslint-disable-next-line no-console
  console.log('[dlog]', body?.sid ?? '-', body?.ts ?? '-', body?.msg, body?.data === undefined ? '' : JSON.stringify(body.data))
  return { ok: true }
})
