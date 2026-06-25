export const CATEGORY_KEYS = [
  'food',
  'groceries',
  'transport',
  'lodging',
  'activities',
  'shopping',
  'other',
] as const

export type CategoryKey = typeof CATEGORY_KEYS[number]

interface CategoryMeta {
  key: CategoryKey
  label: string // zh-TW display label
  icon: string // @nuxt/icon name
  chipClass: string // Tailwind classes for the chip background + text
  color: string // solid hex for charts (matches the chip hue)
}

const CATEGORY_META: Record<CategoryKey, CategoryMeta> = {
  food: { key: 'food', label: '餐飲', icon: 'lucide:utensils', chipClass: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300', color: '#f97316' },
  groceries: { key: 'groceries', label: '超市雜貨', icon: 'lucide:shopping-basket', chipClass: 'bg-lime-100 text-lime-700 dark:bg-lime-950 dark:text-lime-300', color: '#84cc16' },
  transport: { key: 'transport', label: '交通', icon: 'lucide:car', chipClass: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300', color: '#0ea5e9' },
  lodging: { key: 'lodging', label: '住宿', icon: 'lucide:bed-double', chipClass: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300', color: '#8b5cf6' },
  activities: { key: 'activities', label: '活動娛樂', icon: 'lucide:ticket', chipClass: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300', color: '#ec4899' },
  shopping: { key: 'shopping', label: '購物', icon: 'lucide:shopping-bag', chipClass: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300', color: '#f59e0b' },
  other: { key: 'other', label: '其他', icon: 'lucide:tag', chipClass: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', color: '#94a3b8' },
}

function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === 'string' && (CATEGORY_KEYS as readonly string[]).includes(value)
}

export function coerceCategory(value: unknown): CategoryKey {
  return isCategoryKey(value) ? value : 'other'
}

export function getCategoryMeta(value: unknown): CategoryMeta {
  return CATEGORY_META[coerceCategory(value)]
}

// Ordered metadata list for building pickers.
export const CATEGORY_LIST: CategoryMeta[] = CATEGORY_KEYS.map(k => CATEGORY_META[k])
