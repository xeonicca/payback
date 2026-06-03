// composables/useCurrencyToggle.ts
import type { Trip } from '@/types'

// Global reactive map: tripId -> boolean (true = show home currency)
const showHomeCurrencyMap = reactive<Record<string, boolean>>({})

export function useCurrencyToggle(tripId: MaybeRefOrGetter<string>, trip: Ref<Trip | null | undefined>) {
  const { logEvent } = useAnalytics()

  const showHomeCurrency = computed({
    get: () => showHomeCurrencyMap[toValue(tripId)] ?? false,
    set: (val: boolean) => { showHomeCurrencyMap[toValue(tripId)] = val },
  })

  const toggleCurrency = () => {
    showHomeCurrency.value = !showHomeCurrency.value
    logEvent('currency_toggle', { trip_id: toValue(tripId), show_home: showHomeCurrency.value })
  }

  const hasDualCurrency = computed(() => {
    return !!trip.value?.exchangeRate && trip.value.exchangeRate !== 1
  })

  const primaryCurrency = computed(() => {
    if (!trip.value)
      return ''
    return showHomeCurrency.value ? trip.value.defaultCurrency : trip.value.tripCurrency
  })

  const secondaryCurrency = computed(() => {
    if (!trip.value)
      return ''
    return showHomeCurrency.value ? trip.value.tripCurrency : trip.value.defaultCurrency
  })

  const toPrimary = (amount: number, exchangeRate?: number): number => {
    if (!trip.value)
      return amount
    const rate = exchangeRate ?? trip.value.exchangeRate
    return showHomeCurrency.value ? amount * rate : amount
  }

  const toSecondary = (amount: number, exchangeRate?: number): number => {
    if (!trip.value)
      return amount
    const rate = exchangeRate ?? trip.value.exchangeRate
    return showHomeCurrency.value ? amount : amount * rate
  }

  return {
    showHomeCurrency,
    toggleCurrency,
    hasDualCurrency,
    primaryCurrency,
    secondaryCurrency,
    toPrimary,
    toSecondary,
  }
}
