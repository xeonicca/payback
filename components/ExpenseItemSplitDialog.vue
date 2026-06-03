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

const allSelected = computed(() =>
  splitMemberIds.value.length === props.shareableMembers.length && props.shareableMembers.length > 0,
)

watch(() => props.open, (open) => {
  if (open) {
    splitQuantity.value = 1
    splitMemberIds.value = []
  }
})

function toggleMember(memberId: string) {
  const current = splitMemberIds.value
  splitMemberIds.value = current.includes(memberId)
    ? current.filter(id => id !== memberId)
    : [...current, memberId]
}

function toggleAll() {
  splitMemberIds.value = allSelected.value ? [] : props.shareableMembers.map(m => m.id)
}

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
  <ui-dialog :open="open" @update:open="(val) => emit('update:open', val)">
    <ui-dialog-content class="max-w-md" @open-auto-focus.prevent>
      <ui-dialog-header>
        <ui-dialog-title>拆分項目</ui-dialog-title>
        <ui-dialog-description class="text-xs text-muted-foreground">
          將部分數量拆分為新項目，並指定分攤成員
        </ui-dialog-description>
      </ui-dialog-header>

      <div v-if="item" class="space-y-4 py-2">
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
          <p v-if="wouldEmptyOriginal" class="text-xs text-destructive -mt-1">
            拆出後原項目將沒有分攤成員，請取消勾選至少一位成員
          </p>
          <div class="space-y-1 rounded-xl border p-1">
            <div
              class="flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors hover:bg-slate-50"
              :class="allSelected ? 'border-indigo-200 bg-indigo-50/50' : 'border-transparent'"
              @click="toggleAll"
            >
              <ui-checkbox
                :model-value="allSelected"
                @click.stop
                @update:model-value="toggleAll"
              />
              <span class="text-sm font-semibold text-foreground flex-1">全選</span>
            </div>
            <div class="border-t border-slate-100 mx-1" />
            <div
              v-for="member in shareableMembers"
              :key="member.id"
              class="flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors hover:bg-slate-50"
              :class="splitMemberIds.includes(member.id) ? 'border-indigo-200 bg-indigo-50/50' : 'border-transparent'"
              @click="toggleMember(member.id)"
            >
              <ui-checkbox
                :model-value="splitMemberIds.includes(member.id)"
                @click.stop
                @update:model-value="toggleMember(member.id)"
              />
              <member-avatar :emoji="member.avatarEmoji" size="sm" />
              <span class="text-sm font-medium text-foreground flex-1">{{ member.name }}</span>
            </div>
          </div>
        </div>
      </div>

      <ui-dialog-footer class="flex-row gap-2">
        <ui-button
          type="button"
          variant="outline"
          class="flex-1"
          @click="handleClose"
        >
          取消
        </ui-button>
        <ui-button
          type="button"
          class="flex-1"
          :disabled="!canSplit"
          @click="handleConfirm"
        >
          拆分
        </ui-button>
      </ui-dialog-footer>
    </ui-dialog-content>
  </ui-dialog>
</template>
