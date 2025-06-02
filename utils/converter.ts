import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
  WithFieldValue,
} from 'firebase/firestore'
import type { Expense, Trip, TripMember } from '@/types'
import { formatFirebaseTimestamp } from '@/utils/date'

export const tripConverter: FirestoreDataConverter<Trip> = {
  toFirestore(trip: WithFieldValue<Trip>): DocumentData {
    const { id, ...data } = trip
    return data
  },
  fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions): Trip {
    const data = snapshot.data(options)
    return {
      id: snapshot.id,
      name: data.name,
      tripCurrency: data.tripCurrency,
      exchangeRate: data.exchangeRate,
      defaultCurrency: data.defaultCurrency || 'TWD',
      createdAt: data.createdAt,
      createdAtString: formatFirebaseTimestamp(data.createdAt),
      userId: data.userId,
      totalExpenses: data.totalExpenses || 0,
      expenseCount: data.expenseCount || 0,
    } as Trip
  },
}

export const tripMemberConverter: FirestoreDataConverter<TripMember> = {
  toFirestore(member: WithFieldValue<TripMember>): DocumentData {
    const { id, ...data } = member
    return data
  },
  fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions): TripMember {
    const data = snapshot.data(options)
    return {
      id: snapshot.id,
      name: data.name,
      avatarEmoji: data.avatarEmoji,
      createdAt: data.createdAt,
      createdAtString: formatFirebaseTimestamp(data.createdAt),
      isHost: data.isHost || false,
    } as TripMember
  },
}

export const expenseConverter: FirestoreDataConverter<Expense> = {
  toFirestore(expense: WithFieldValue<Expense>): DocumentData {
    const { id, ...data } = expense
    return data
  },
  fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions): Expense {
    const data = snapshot.data(options)

    return {
      id: snapshot.id,
      description: data.description,
      grandTotal: data.grandTotal,
      date: data.date,
      category: data.category,
      paidByMemberId: data.paidByMemberId,
      paidByMemberName: data.paidByMemberName,
      sharedWithMemberIds: data.sharedWithMemberIds || [],
      createdAt: data.createdAt,
      createdAtString: formatFirebaseTimestamp(data.createdAt),
      paidAt: data.paidAt,
      paidAtString: formatFirebaseTimestamp(data.paidAt),
      paidAtObject: formatFirebaseDateAndTime(data.paidAt),
      imageUrls: data.imageUrls || [],
      receiptImageUrl: data.receiptImageUrl,
      isProcessing: data.isProcessing,
      items: data.items || [],
    } as Expense
  },
}
