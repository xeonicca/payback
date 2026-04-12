interface TwdCurrency {
  twd: Record<string, number>
}

export function useExchangeRate(
  tripCurrency: MaybeRef<string>,
  defaultCurrency: MaybeRef<string>,
  fallbackRate: MaybeRef<number>,
) {
  const rate = ref(toValue(fallbackRate))
  const isLoading = ref(false)
  const error = ref<Error | null>(null)

  async function fetchRate() {
    const tc = toValue(tripCurrency)
    const dc = toValue(defaultCurrency)

    // Same currency — rate is always 1
    if (tc === dc) {
      rate.value = 1
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const data = await $fetch<TwdCurrency>(
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/twd.json',
      )

      const tcRate = data.twd[tc.toLowerCase()]
      const dcRate = data.twd[dc.toLowerCase()]

      if (tcRate && dcRate) {
        // exchangeRate = how many defaultCurrency units per 1 tripCurrency unit
        rate.value = Math.round((dcRate / tcRate) * 10000) / 10000
      }
      else {
        rate.value = toValue(fallbackRate)
      }
    }
    catch (e) {
      error.value = e instanceof Error ? e : new Error('Failed to fetch exchange rate')
      rate.value = toValue(fallbackRate)
    }
    finally {
      isLoading.value = false
    }
  }

  return {
    rate,
    isLoading,
    error,
    fetchRate,
  }
}
