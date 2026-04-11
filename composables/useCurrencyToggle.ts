// composables/useCurrencyToggle.ts
import type { Trip } from '@/types'

// Global reactive map: tripId -> boolean (true = show home currency)
const showHomeCurrencyMap = reactive<Record<string, boolean>>({})

export function useCurrencyToggle(tripId: string, trip: Ref<Trip | null | undefined>) {
  const showHomeCurrency = computed({
    get: () => showHomeCurrencyMap[tripId] ?? false,
    set: (val: boolean) => { showHomeCurrencyMap[tripId] = val },
  })

  const toggleCurrency = () => {
    showHomeCurrency.value = !showHomeCurrency.value
  }

  const hasDualCurrency = computed(() => {
    return !!trip.value?.exchangeRate && trip.value.exchangeRate !== 1
  })

  const primaryCurrency = computed(() => {
    if (!trip.value) return ''
    return showHomeCurrency.value ? trip.value.defaultCurrency : trip.value.tripCurrency
  })

  const secondaryCurrency = computed(() => {
    if (!trip.value) return ''
    return showHomeCurrency.value ? trip.value.tripCurrency : trip.value.defaultCurrency
  })

  const toPrimary = (amount: number): number => {
    if (!trip.value) return amount
    return showHomeCurrency.value ? amount * trip.value.exchangeRate : amount
  }

  const toSecondary = (amount: number): number => {
    if (!trip.value) return amount
    return showHomeCurrency.value ? amount : amount * trip.value.exchangeRate
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
