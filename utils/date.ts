import type { Timestamp } from 'firebase/firestore'

/**
 * Converts a Firebase Timestamp to a localized datetime string in en-US format
 * @param timestamp Firebase Timestamp
 * @returns Formatted datetime string (e.g., "2024/03/14 14:30") or empty string if timestamp is null/undefined
 */
export function formatFirebaseTimestamp(timestamp: Timestamp | null | undefined): string {
  if (!timestamp)
    return ''

  // Convert Firebase Timestamp to milliseconds
  const milliseconds = timestamp.toMillis()
  const date = new Date(milliseconds)

  // Format the date and time
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, '$3/$1/$2')
}

/**
 * Converts a Firebase Timestamp to a localized date string in en-US format
 * @param timestamp Firebase Timestamp
 * @returns Formatted date string (e.g., "2024/03/14") or empty string if timestamp is null/undefined
 */
export function formatFirebaseDate(timestamp: Timestamp | null | undefined): string {
  if (!timestamp)
    return ''

  const milliseconds = timestamp.toMillis()
  const date = new Date(milliseconds)

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, '$3/$1/$2')
}

/**
 * Converts a Firebase Timestamp to a localized time string in en-US format
 * @param timestamp Firebase Timestamp
 * @returns Formatted time string (e.g., "14:30") or empty string if timestamp is null/undefined
 */
export function formatFirebaseTime(timestamp: Timestamp | null | undefined): string {
  if (!timestamp)
    return ''

  const milliseconds = timestamp.toMillis()
  const date = new Date(milliseconds)

  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
