import type { InvitationPreviewState } from '~/types'

interface InvitationStateFields {
  status?: string
  expiresAt: { toMillis: () => number }
  maxUses?: number | null
  usedCount?: number
}

/** A missing maxUses predates multi-use links and means single-use; null means unlimited. */
export function normalizeMaxUses(maxUses: number | null | undefined): number | null {
  return maxUses === undefined ? 1 : maxUses
}

/** Precedence: revoked > expired > used > valid. */
export function getInvitationState(invitation: InvitationStateFields, nowMs = Date.now()): InvitationPreviewState {
  if (invitation.status === 'revoked')
    return 'revoked'
  if (invitation.status === 'expired' || invitation.expiresAt.toMillis() < nowMs)
    return 'expired'
  const maxUses = normalizeMaxUses(invitation.maxUses)
  // 'accepted' is only written once a finite limit is used up; legacy docs have no usedCount
  if (maxUses !== null && (invitation.status === 'accepted' || (invitation.usedCount ?? 0) >= maxUses))
    return 'used'
  return 'valid'
}
