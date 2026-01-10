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
  archived?: boolean
  collaboratorCount?: number
  isPublicInviteEnabled?: boolean
}

export interface Trip extends NewTrip {
  id: string
  createdAtString: string
  totalExpenses: number
  enabledTotalExpenses: number
  disabledTotalExpenses: number
  archived: boolean
  collaboratorCount: number
  isPublicInviteEnabled: boolean
}

export interface ExpenseDetailItem {
  name: string
  price: number
  quantity?: number
  translatedName?: string
  sharedByMemberIds?: string[]
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
  items?: Array<ExpenseDetailItem>
  inputCurrency?: string // The currency used when entering this expense
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

export interface NewTripCollaborator {
  userId: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  role: 'owner' | 'editor'
  joinedAt: Timestamp | FieldValue
  invitedBy?: string
}

export interface TripCollaborator extends NewTripCollaborator {
  joinedAtString: string
}

export interface NewInvitation {
  tripId: string
  tripName: string
  invitedByUserId: string
  invitedByName: string
  invitationCode: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  expiresAt: Timestamp | FieldValue
  createdAt: Timestamp | FieldValue
  usedByUserId?: string
  usedAt?: Timestamp | FieldValue
}

export interface Invitation extends NewInvitation {
  id: string
  createdAtString: string
  expiresAtString: string
  usedAtString?: string
}
