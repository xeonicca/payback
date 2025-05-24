import type { AppUser } from '@/types'

export function useSessionUser() {
  return useState<AppUser | null>('sessionUser', () => null)
}
