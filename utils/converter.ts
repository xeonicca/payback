import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
  WithFieldValue,
} from 'firebase/firestore'
import type { Expense, Invitation, Trip, TripCollaborator, TripMember } from '@/types'
import { formatFirebaseDateAndTime, formatFirebaseTimestamp } from '@/utils/date'

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
      enabledTotalExpenses: data.enabledTotalExpenses || 0,
      disabledTotalExpenses: data.disabledTotalExpenses || 0,
      expenseCount: data.expenseCount || 0,
      archived: data.archived || false,
      collaboratorCount: data.collaboratorCount || 0,
      isPublicInviteEnabled: data.isPublicInviteEnabled || true,
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
      spending: data.spending || 0,
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
      enabled: data.enabled ?? true,
    } as Expense
  },
}

export const tripCollaboratorConverter: FirestoreDataConverter<TripCollaborator> = {
  toFirestore(collaborator: WithFieldValue<TripCollaborator>): DocumentData {
    return {
      userId: collaborator.userId,
      email: collaborator.email,
      displayName: collaborator.displayName,
      photoURL: collaborator.photoURL,
      role: collaborator.role,
      joinedAt: collaborator.joinedAt,
      invitedBy: collaborator.invitedBy,
    }
  },
  fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions): TripCollaborator {
    const data = snapshot.data(options)
    return {
      userId: data.userId,
      email: data.email,
      displayName: data.displayName,
      photoURL: data.photoURL,
      role: data.role,
      joinedAt: data.joinedAt,
      joinedAtString: formatFirebaseTimestamp(data.joinedAt),
      invitedBy: data.invitedBy,
    } as TripCollaborator
  },
}

export const invitationConverter: FirestoreDataConverter<Invitation> = {
  toFirestore(invitation: WithFieldValue<Invitation>): DocumentData {
    const { id, ...data } = invitation
    return data
  },
  fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions): Invitation {
    const data = snapshot.data(options)
    return {
      id: snapshot.id,
      tripId: data.tripId,
      tripName: data.tripName,
      invitedByUserId: data.invitedByUserId,
      invitedByName: data.invitedByName,
      invitationCode: data.invitationCode,
      status: data.status,
      expiresAt: data.expiresAt,
      expiresAtString: formatFirebaseTimestamp(data.expiresAt),
      createdAt: data.createdAt,
      createdAtString: formatFirebaseTimestamp(data.createdAt),
      usedByUserId: data.usedByUserId,
      usedAt: data.usedAt,
      usedAtString: data.usedAt ? formatFirebaseTimestamp(data.usedAt) : undefined,
    } as Invitation
  },
}
