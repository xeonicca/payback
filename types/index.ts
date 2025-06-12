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
  expenseCount: number
  exchangeRate: number
  defaultCurrency: string
  userId: string
  createdAt: Timestamp | FieldValue
}

export interface Trip extends NewTrip {
  id: string
  createdAtString: string
  totalExpenses: number
  enabledTotalExpenses: number
  disabledTotalExpenses: number
}

export interface NewExpense {
  description: string
  grandTotal: number // In trip's currency
  paidAt: Timestamp | FieldValue
  category?: string
  paidByMemberId: string
  sharedWithMemberIds: string[]
  createdAt: Timestamp | FieldValue
  imageUrls?: string[] // URLs of uploaded images
  isProcessing: boolean
  enabled: boolean // New field with default value true
  items?: Array<{
    name: string
    price: number
    quantity?: number
    translatedName?: string
  }>
}

export interface Expense extends NewExpense {
  id: string
  paidAtString: string
  paidAtObject: {
    year: string
    month: string
    day: string
    hour: string
    minute: string
  }
  createdAtString: string
  receiptImageUrl?: string
}

export interface Currency {
  code: string
  name: string
}
