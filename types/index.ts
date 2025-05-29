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
  spending?: number
  isHost: boolean
}

export interface TripMember extends NewTripMember {
  id: string
  createdAtString: string
}

export interface NewTrip {
  name: string
  tripCurrency: string // e.g., 'USD', 'JPY'
  exchangeRate: number
  defaultCurrency: string
  userId: string
  createdAt: Timestamp | FieldValue
}

export interface Trip extends NewTrip {
  id: string
  createdAtString: string
}

export interface NewExpense {
  description: string
  grandTotal: number // In trip's currency
  paidAt: Timestamp
  category?: string
  paidByMemberId: string
  paidByMemberName: string
  sharedWithMemberIds: string[]
  createdAt: Timestamp | FieldValue
  imageUrls?: string[] // URLs of uploaded images
  isProcessing: boolean
  items?: Array<{
    name: string
    price: number
  }>
}

export interface Expense extends NewExpense {
  id: string
  paidAtString: string
  createdAtString: string
}

export interface Currency {
  code: string
  name: string
}
