import { getFirebaseAdminAuth } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const auth = getFirebaseAdminAuth()
  const config = useRuntimeConfig()

  const { firebaseIdToken } = await readBody(event)

  try {
    const sessionCookie = await auth.createSessionCookie(firebaseIdToken, {
      expiresIn: Number(config.authCookieExpires),
    })

    setCookie(event, config.authCookieName as string, sessionCookie as string, {
      maxAge: Number(config.authCookieExpires),
      sameSite: 'strict',
      httpOnly: true,
      secure: config.public.nodeEnv === 'production',
      path: '/',
    })

    const token = await auth.verifySessionCookie(sessionCookie, true)

    const user = await auth.getUser(token.uid)
    return {
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      uid: user.uid,
    }
  }
  catch (error) {
    return createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
      data: error,
    })
  }
})
