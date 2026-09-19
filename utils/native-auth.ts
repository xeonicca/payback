import type { Auth } from 'firebase/auth'
import { GoogleAuthProvider, linkWithCredential, signInWithCredential } from 'firebase/auth'

export async function authenticateWithNativeGoogle(auth: Auth, upgrade = false) {
  const currentUser = auth.currentUser
  if (upgrade && !currentUser)
    throw new Error('請先登入訪客帳號')

  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
  const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true })
  const idToken = result.credential?.idToken
  if (!idToken)
    throw new Error('無法取得 Google 登入憑證，請重試')
  const credential = GoogleAuthProvider.credential(idToken)

  if (upgrade) {
    if (auth.currentUser?.uid !== currentUser!.uid)
      throw new Error('登入狀態已變更，請重試')
    return (await linkWithCredential(currentUser!, credential)).user
  }
  return (await signInWithCredential(auth, credential)).user
}
