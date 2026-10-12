/**
 * Some locales' decimal keypads offer "," instead of "." as the decimal
 * separator, which Number()/parseFloat can't read. Treat every comma as a dot.
 */
export function toDotDecimal(value: string): string {
  return value.replaceAll(',', '.')
}

/**
 * @input handler for amount fields: rewrites commas to dots in place (keeping
 * the caret where it was), then re-dispatches `input` so v-model and other
 * listeners pick up the normalized value no matter which ran first.
 */
export function normalizeDecimalInput(event: Event) {
  const el = event.target as HTMLInputElement | null
  if (!el || !el.value.includes(','))
    return
  const { selectionStart, selectionEnd } = el
  el.value = toDotDecimal(el.value)
  el.setSelectionRange(selectionStart, selectionEnd)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
