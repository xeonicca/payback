import type { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'

// No 0/O, 1/I/L — codes get read aloud and retyped from chat apps.
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
// Largest multiple of the alphabet size below 256, so `byte % size` is unbiased.
const UNBIASED_LIMIT = 256 - (256 % CODE_ALPHABET.length)

export function generateCode(length = 10): string {
  let code = ''
  while (code.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= UNBIASED_LIMIT)
        continue
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
      if (code.length === length)
        break
    }
  }
  return code
}

export async function generateUniqueCode(isTaken: (code: string) => Promise<boolean>, length = 10): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode(length)
    if (!(await isTaken(code)))
      return code
  }
  throw new Error('Could not generate a unique code')
}

export function invitationCodeTaken(db: Firestore) {
  return async (code: string) =>
    !(await db.collection('invitations').where('invitationCode', '==', code).limit(1).get()).empty
}

export function publicJoinCodeTaken(db: Firestore) {
  return async (code: string) =>
    !(await db.collection('trips').where('publicJoinCode', '==', code).limit(1).get()).empty
}
