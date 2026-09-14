<script setup lang="ts">
import type { ExpenseDetailItem } from '@/types'

const props = defineProps<{
  open: boolean
  item: ExpenseDetailItem | null
  itemIndex: number | null
  currency: string
  shareableMembers: Array<{ id: string, name: string, avatarEmoji: string }>
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
  (e: 'split', index: number, splitQuantity: number, splitMemberIds: string[]): void
}>()

const splitQuantity = ref(1)
const splitMemberIds = ref<string[]>([])

const originalQuantity = computed(() => props.item?.quantity ?? 1)
const maxSplitQuantity = computed(() => Math.max(0, originalQuantity.value - 1))

const isValidQuantity = computed(() =>
  Number.isInteger(splitQuantity.value)
  && splitQuantity.value >= 1
  && splitQuantity.value <= maxSplitQuantity.value,
)

const hasMembers = computed(() => splitMemberIds.value.length > 0)

// Materialize the "[] means all expense sharers" convention so we can correctly
// detect when the split would empty the original.
const originalEffectiveSharers = computed(() => {
  if (!props.item)
    return [] as string[]
  return props.item.sharedByMemberIds && props.item.sharedByMemberIds.length > 0
    ? props.item.sharedByMemberIds
    : props.shareableMembers.map(m => m.id)
})

const wouldEmptyOriginal = computed(() => {
  if (!hasMembers.value || originalEffectiveSharers.value.length === 0)
    return false
  const splitSet = new Set(splitMemberIds.value)
  return originalEffectiveSharers.value.every(id => splitSet.has(id))
})

const canSplit = computed(() =>
  isValidQuantity.value
  && hasMembers.value
  && !wouldEmptyOriginal.value
  && props.itemIndex !== null,
)

watch(() => props.open, (open) => {
  if (open) {
    splitQuantity.value = 1
    splitMemberIds.value = []
  }
})

function handleConfirm() {
  if (!canSplit.value || props.itemIndex === null)
    return
  emit('split', props.itemIndex, splitQuantity.value, [...splitMemberIds.value])
  emit('update:open', false)
}

function handleClose() {
  emit('update:open', false)
}
</script>

<template>
  <responsive-dialog
    :open="open"
    title="拆分項目"
    description="將部分數量拆分為新項目，並指定分攤成員"
    @update:open="(val) => emit('update:open', val)"
  >
    <div v-if="item" class="space-y-4">
      <!-- Item summary -->
      <div class="bg-muted/50 rounded-lg p-3 space-y-1">
        <div class="text-sm font-medium text-foreground">
          {{ item.name || '未命名' }}
        </div>
        <div class="text-xs text-muted-foreground font-mono">
          {{ currency }} {{ item.price.toFixed(2) }} × {{ originalQuantity }}
        </div>
      </div>

      <!-- Split quantity -->
      <div>
        <ui-label class="text-sm font-medium text-foreground">
          拆分數量
        </ui-label>
        <ui-input
          v-model.number="splitQuantity"
          type="number"
          :min="1"
          :max="maxSplitQuantity"
          class="mt-1"
        />
        <p class="text-xs text-muted-foreground mt-1">
          <template v-if="maxSplitQuantity < 1">
            此項目數量為 {{ originalQuantity }}，無法拆分
          </template>
          <template v-else-if="!isValidQuantity">
            請輸入 1 ~ {{ maxSplitQuantity }} 的整數
          </template>
          <template v-else>
            拆出 {{ splitQuantity }} 個，原項目保留 {{ originalQuantity - splitQuantity }} 個
          </template>
        </p>
      </div>

      <!-- Member selection -->
      <div v-if="shareableMembers.length > 0" class="space-y-2">
        <ui-label>新項目分攤成員</ui-label>
        <p class="text-xs text-muted-foreground -mt-1">
          選擇拆出的新項目由誰分攤（這些成員將不再分攤原項目）
        </p>
        <p v-if="wouldEmptyOriginal" role="alert" class="text-xs text-destructive -mt-1">
          拆出後原項目將沒有分攤成員，請取消勾選至少一位成員
        </p>
        <member-picker
          v-model="splitMemberIds"
          :members="shareableMembers"
          multiple
          select-all
          label="新項目分攤成員"
          :invalid="wouldEmptyOriginal"
        />
        <!-- Neutral, not an error: nobody is selected when the dialog opens -->
        <p v-if="!hasMembers" class="text-xs text-muted-foreground">
          選擇至少一位成員後即可拆分
        </p>
      </div>
    </div>

    <template #footer>
      <ui-button
        type="button"
        variant="outline"
        class="h-11 flex-1 lg:h-9"
        @click="handleClose"
      >
        取消
      </ui-button>
      <ui-button
        type="button"
        class="h-11 flex-1 lg:h-9"
        :disabled="!canSplit"
        @click="handleConfirm"
      >
        拆分
      </ui-button>
    </template>
  </responsive-dialog>
</template>
