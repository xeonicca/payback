// Registry of all Firebase Analytics custom events and their params.
// Adding an event here makes it usable via useAnalytics().logEvent with full
// type-checking on the name and params — typos fail at compile time instead of
// being silently dropped by GA.

export interface AnalyticsEventMap {
  page_view: { page_path: string, page_title: string }
  login: { method: string }
  logout: undefined

  create_trip: { trip_id: string }
  edit_trip: { trip_id: string, members_added: number, members_removed: number }
  join_trip: { method: 'invitation' | 'public_link', trip_id: string }

  add_expense: { method: 'receipt' | 'manual', trip_id: string }
  edit_expense: { trip_id: string, section: 'basics' | 'sharers' }
  delete_expense: { trip_id: string }
  toggle_expense: { trip_id: string, enabled: boolean }
  edit_expense_item: { trip_id: string, action: 'add' | 'delete' | 'split' | 'edit' }

  apply_tax_deduction: { trip_id: string, percentage: number }
  apply_discount: { trip_id: string, percentage: number }
  reanalyze_receipt: { trip_id: string }

  currency_toggle: { trip_id: string, show_home: boolean }

  create_invitation: { trip_id: string, type: 'collaborator' | 'guest' }
  guest_upgrade: { trip_id?: string }
}

export type AnalyticsEventName = keyof AnalyticsEventMap

// logEvent(name) for events with no params, logEvent(name, params) otherwise.
export type LogEventArgs<K extends AnalyticsEventName>
  = AnalyticsEventMap[K] extends undefined ? [] : [params: AnalyticsEventMap[K]]
