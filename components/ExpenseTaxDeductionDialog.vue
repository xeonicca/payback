<script setup lang="ts">
import type { ExpenseDetailItem } from '@/types'
import { applyTaxDeduction } from '@/utils/tax'

const props = defineProps<{
  open: boolean
  currency: string
  currentGrandTotal: number
  currentItems: Array<ExpenseDetailItem>
  isSaving?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
  (e: 'confirm', percentage: number): void
}>()

const percentageOptions = [7, 8, 9, 10]
const selectedPercentage = ref<number | null>(null)

watch(() => props.open, (open) => {
  if (open) {
    selectedPercentage.value = null
  }
})

const preview = computed(() => {
  if (selectedPercentage.value === null || !props.currentItems.length)
    return null
  return applyTaxDeduction(props.currentItems, selectedPercentage.value)
})

const reduction = computed(() => {
  if (!preview.value)
    return 0
  return Math.round((props.currentGrandTotal - preview.value.grandTotal) * 100) / 100
})

function handleOpenChange(val: boolean) {
  emit('update:open', val)
}

function handleConfirm() {
  if (selectedPercentage.value === null)
    return
  emit('confirm', selectedPercentage.value)
}
</script>

<template>
  <ui-dialog :open="open" @update:open="handleOpenChange">
    <ui-dialog-content class="max-w-md" @open-auto-focus.prevent>
      <ui-dialog-header>
        <ui-dialog-title>扣除消費稅</ui-dialog-title>
        <ui-dialog-description>
          選擇要扣除的消費稅百分比，每個項目的價格將以「price ÷ (1 + 稅率)」重新計算。
        </ui-dialog-description>
      </ui-dialog-header>

      <div class="space-y-4 py-2">
        <!-- Empty-state warning -->
        <div v-if="!currentItems.length" class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          此支出沒有明細項目，無法套用消費稅扣除。請先新增明細項目。
        </div>

        <!-- Percentage buttons -->
        <div v-else>
          <ui-label class="text-sm font-medium text-foreground">
            稅率
          </ui-label>
          <div class="grid grid-cols-4 gap-2 mt-2">
            <ui-button
              v-for="pct in percentageOptions"
              :key="pct"
              type="button"
              :variant="selectedPercentage === pct ? 'default' : 'outline'"
              :disabled="isSaving"
              @click="selectedPercentage = pct"
            >
              {{ pct }}%
            </ui-button>
          </div>
        </div>

        <!-- Preview -->
        <div v-if="preview" class="rounded-lg border bg-muted/40 p-3 space-y-2">
          <div class="text-xs text-muted-foreground">
            預覽
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">原總金額</span>
            <span class="font-mono text-foreground">{{ currency }} {{ currentGrandTotal.toFixed(2) }}</span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">扣除 {{ selectedPercentage }}%</span>
            <span class="font-mono text-red-600 dark:text-red-400">- {{ currency }} {{ reduction.toFixed(2) }}</span>
          </div>
          <div class="border-t border-border pt-2 flex items-center justify-between">
            <span class="text-sm font-medium text-foreground">扣稅後總金額</span>
            <span class="font-mono text-base font-bold text-primary">{{ currency }} {{ preview.grandTotal.toFixed(2) }}</span>
          </div>
        </div>
      </div>

      <ui-dialog-footer class="flex-row gap-2">
        <ui-button
          type="button"
          variant="outline"
          class="flex-1"
          :disabled="isSaving"
          @click="handleOpenChange(false)"
        >
          取消
        </ui-button>
        <ui-button
          type="button"
          class="flex-1"
          :disabled="isSaving || selectedPercentage === null || !currentItems.length"
          @click="handleConfirm"
        >
          <Icon v-if="isSaving" name="lucide:loader-2" class="animate-spin mr-2" :size="16" />
          {{ isSaving ? '套用中...' : '確認套用' }}
        </ui-button>
      </ui-dialog-footer>
    </ui-dialog-content>
  </ui-dialog>
</template>
