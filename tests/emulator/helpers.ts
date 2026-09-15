import type { AppUser } from '@/types'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { vi } from 'vitest'

export const PROJECT_ID = 'demo-payback'
const APP_NAME = 'emulator-tests'

export function getAdminDb() {
  const app = getApps().find(a => a.name === APP_NAME) ?? initializeApp({ projectId: PROJECT_ID }, APP_NAME)
  return getFirestore(app)
}

export async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  if (!host)
    throw new Error('FIRESTORE_EMULATOR_HOST is not set — run via `pnpm test:emulator`')
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
}

export function stubH3Globals() {
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal('createError', (data: { statusCode: number, statusMessage: string }) =>
    Object.assign(new Error(data.statusMessage), data))
  vi.stubGlobal('readBody', async (event: any) => event.body ?? {})
  vi.stubGlobal('getQuery', (event: any) => event.query ?? {})
  vi.stubGlobal('getRouterParam', (event: any, name: string) => event.params?.[name])
  vi.stubGlobal('getRequestURL', () => new URL('http://localhost:3000'))
}

export function makeEvent(opts: {
  user?: AppUser | null
  body?: unknown
  query?: Record<string, unknown>
  params?: Record<string, string>
} = {}): any {
  return {
    context: opts.user ? { appUser: opts.user } : {},
    body: opts.body,
    query: opts.query,
    params: opts.params,
  }
}

export function googleUser(uid: string): AppUser {
  return { uid, email: `${uid}@example.com`, displayName: uid, photoURL: null, isAnonymous: false }
}

export function anonUser(uid: string): AppUser {
  return { uid, email: null, displayName: null, photoURL: null, isAnonymous: true }
}

export interface SeedCollaborator {
  uid: string
  role: 'owner' | 'editor' | 'guest'
  readOnly?: boolean
  /** false = collaborator doc exists but uid is missing from collaboratorUserIds (half-joined) */
  inArray?: boolean
}

export async function seedTrip(opts: {
  tripId?: string
  ownerUid?: string
  collaborators?: SeedCollaborator[]
  members?: Array<{ id: string, name: string, linkedUserId?: string }>
  trip?: Record<string, unknown>
} = {}) {
  const db = getAdminDb()
  const tripId = opts.tripId ?? 't1'
  const ownerUid = opts.ownerUid ?? 'owner'
  const collaborators = opts.collaborators ?? [{ uid: ownerUid, role: 'owner' }]
  const tripRef = db.collection('trips').doc(tripId)

  await tripRef.set({
    name: 'Test Trip',
    userId: ownerUid,
    collaboratorUserIds: collaborators.filter(c => c.inArray !== false).map(c => c.uid),
    collaboratorCount: collaborators.length,
    isPublicInviteEnabled: false,
    publicJoinCode: null,
    ...opts.trip,
  })
  for (const c of collaborators) {
    await tripRef.collection('collaborators').doc(c.uid).set({
      userId: c.uid,
      role: c.role,
      readOnly: c.readOnly ?? false,
      email: null,
      displayName: c.uid,
      photoURL: null,
    })
  }
  for (const m of opts.members ?? []) {
    await tripRef.collection('members').doc(m.id).set({
      name: m.name,
      avatarEmoji: '🐭',
      isHost: false,
      spending: 0,
      createdAt: Timestamp.now(),
      ...(m.linkedUserId ? { linkedUserId: m.linkedUserId } : {}),
    })
  }
  return tripRef
}

export async function seedInvitation(id: string, data: Record<string, unknown> = {}) {
  await getAdminDb().collection('invitations').doc(id).set({
    tripId: 't1',
    tripName: 'Test Trip',
    invitedByUserId: 'owner',
    invitedByName: 'Owner',
    invitationCode: id,
    status: 'pending',
    expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: Timestamp.now(),
    maxUses: 1,
    usedCount: 0,
    usedByUserIds: [],
    type: 'personal',
    ...data,
  })
}
