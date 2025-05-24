import type { Timestamp } from 'firebase/firestore'

export interface SessionUser {
  uid: string
}

export interface AppUser {
  email: string | null
  displayName: string | null
  photoURL: string | null
  uid: string
}

export interface TripMember {
  id: string // Firestore document ID
  name: string
  avatarEmoji: string // e.g., '🐅'
  createdAt: Timestamp
}

export interface Trip {
  id: string // Firestore document ID
  name: string
  tripCurrency: string // e.g., 'USD', 'JPY'
  exchangeRateToTWD: number
  defaultCurrency: string
  createdAt: Timestamp
  userId?: string
}

export interface Expense {
  id: string // Firestore document ID
  description: string
  amount: number // In trip's currency
  date: Timestamp
  category: string
  paidByMemberId: string
  paidByMemberName: string
  sharedWithMemberIds: string[]
  createdAt: Timestamp
  imageUrls?: string[] // URLs of uploaded images
}
