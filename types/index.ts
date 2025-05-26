import type { FieldValue, Timestamp } from 'firebase/firestore'

export interface SessionUser {
  uid: string
}

export interface AppUser {
  email: string | null
  displayName: string | null
  photoURL: string | null
  uid: string
}

export interface NewTripMember {
  name: string
  avatarEmoji: string
  createdAt: Timestamp | FieldValue
  spending: number
}

export interface TripMember extends Omit<NewTripMember, 'createdAt'> {
  id: string
  createdAt: Timestamp
}

export interface NewTrip {
  name: string
  tripCurrency: string // e.g., 'USD', 'JPY'
  exchangeRateToTWD: number
  defaultCurrency: string
  userId: string
  createdAt: Timestamp | FieldValue
}

export interface Trip extends Omit<NewTrip, 'createdAt'> {
  id: string
  createdAt: Timestamp
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

export interface Currency {
  code: string
  name: string
}
