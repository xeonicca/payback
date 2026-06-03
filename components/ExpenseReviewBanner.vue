<script setup lang="ts">
interface Props {
  reasons: string[]
}

const props = defineProps<Props>()

const WARNING_CODES = new Set([
  'grand_total_mismatch',
  'item_count_mismatch',
  'subtotal_mismatch',
  'item_line_total_mismatch',
  'currency_unexpected',
])

const MESSAGES: Record<string, string> = {
  grand_total_mismatch: '項目金額加總與收據總計不符，請檢查',
  item_count_mismatch: '項目數量與收據上的點數不一致',
  subtotal_mismatch: '項目加總與小計不符',
  item_line_total_mismatch: '部分項目的單價 × 數量與該行金額不符',
  currency_unexpected: '偵測到的貨幣與此次行程貨幣不同',
}

const warnings = computed(() =>
  Array.from(new Set(props.reasons.filter(r => WARNING_CODES.has(r))))
    .map(r => MESSAGES[r])
    .filter(Boolean),
)
</script>

<template>
  <div
    v-if="warnings.length > 0"
    class="border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 rounded-lg p-3 flex gap-3"
  >
    <Icon name="lucide:triangle-alert" class="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" :size="18" />
    <div class="flex-1 space-y-1">
      <p class="text-sm font-medium text-amber-900 dark:text-amber-100">
        AI 辨識結果需要您檢查
      </p>
      <ul class="text-xs text-amber-800 dark:text-amber-200 space-y-0.5 list-disc list-inside">
        <li v-for="w in warnings" :key="w">
          {{ w }}
        </li>
      </ul>
    </div>
  </div>
</template>
