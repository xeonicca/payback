<script setup lang="ts">
import type { ExpenseDetailItem } from '@/types'

const props = defineProps<{
  open: boolean
  item: ExpenseDetailItem | null
  itemIndex: number | null
  currency: string
  shareableMembers: Array<{ id: string, name: string, avatarEmoji: string }>
  isSaving?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
  (e: 'save', index: number, item: ExpenseDetailItem): void
  (e: 'add', item: ExpenseDetailItem): void
  (e: 'delete', index: number): void
}>()

const isAddMode = computed(() => props.itemIndex === null)

const showDeleteConfirm = ref(false)

function handleDeleteClick() {
  if (props.itemIndex === null)
    return
  showDeleteConfirm.value = true
}

function confirmDelete() {
  if (props.itemIndex === null)
    return
  showDeleteConfirm.value = false
  emit('delete', props.itemIndex)
}

const name = ref('')
const priceRaw = ref('')
const quantity = ref(1)
const translatedName = ref('')
const sharedByMemberIds = ref<string[]>([])

const price = computed(() => {
  const n = Number.parseFloat(priceRaw.value)
  return Number.isNaN(n) ? 0 : n
})

watch(() => props.open, (open) => {
  if (!open)
    return
  // Materialize the "[] means all" convention into an explicit list so the
  // member picker shows who actually shares the item.
  // handleSave normalizes back to [] when every member is selected.
  if (props.item) {
    name.value = props.item.name
    priceRaw.value = String(props.item.price)
    quantity.value = props.item.quantity ?? 1
    translatedName.value = props.item.translatedName ?? ''
    sharedByMemberIds.value = props.item.sharedByMemberIds && props.item.sharedByMemberIds.length > 0
      ? [...props.item.sharedByMemberIds]
      : props.shareableMembers.map(m => m.id)
  }
  else {
    name.value = ''
    priceRaw.value = ''
    quantity.value = 1
    translatedName.value = ''
    sharedByMemberIds.value = props.shareableMembers.map(m => m.id)
  }
}, { immediate: true })

function handleOpenChange(val: boolean) {
  emit('update:open', val)
}

function handleClose() {
  emit('update:open', false)
}

function handleSave() {
  const ids = sharedByMemberIds.value
  const normalizedIds = ids.length === props.shareableMembers.length ? [] : ids
  const payload: ExpenseDetailItem = {
    name: name.value,
    price: price.value,
    quantity: quantity.value,
    ...(translatedName.value ? { translatedName: translatedName.value } : {}),
    sharedByMemberIds: normalizedIds,
  }
  if (isAddMode.value) {
    emit('add', payload)
  }
  else {
    emit('save', props.itemIndex as number, payload)
  }
}
</script>

<template>
  <responsive-dialog
    :open="open"
    :title="isAddMode ? '新增明細項目' : '編輯明細項目'"
    description="設定項目名稱、價格、數量與分攤成員"
    hide-description
    @update:open="handleOpenChange"
  >
    <div class="space-y-4">
      <!-- Name -->
      <div>
        <ui-label class="text-sm font-medium text-foreground">名稱</ui-label>
        <ui-input v-model="name" placeholder="項目名稱" autocomplete="off" class="mt-1" />
      </div>

      <!-- Price + Quantity -->
      <div class="flex gap-3">
        <div class="flex-1 min-w-0">
          <ui-label class="text-sm font-medium text-foreground">價格</ui-label>
          <div class="relative mt-1">
            <ui-input
              v-model="priceRaw"
              type="text"
              inputmode="decimal"
              placeholder="0.00"
              class="pl-14 font-mono"
            />
            <ui-badge class="absolute start-0 inset-y-0 flex items-center ml-1 my-1 px-2 pointer-events-none">
              {{ currency }}
            </ui-badge>
          </div>
        </div>
        <div class="w-20 shrink-0">
          <ui-label class="text-sm font-medium text-foreground">數量</ui-label>
          <ui-input v-model.number="quantity" type="number" min="1" placeholder="1" class="mt-1 text-center" />
        </div>
      </div>

      <!-- Translated name -->
      <div>
        <ui-label class="text-sm font-medium text-foreground">
          翻譯名稱
          <span class="text-xs font-normal text-muted-foreground ml-0.5">選填</span>
        </ui-label>
        <ui-input v-model="translatedName" placeholder="本地語言名稱" class="mt-1" />
      </div>

      <!-- Member sharing -->
      <div v-if="shareableMembers.length > 0" class="space-y-2">
        <ui-label>分攤成員</ui-label>
        <p class="text-xs text-muted-foreground -mt-1">
          未選擇則由所有分攤成員共同分攤
        </p>
        <member-picker v-model="sharedByMemberIds" :members="shareableMembers" multiple select-all label="分攤成員" />
      </div>
    </div>

    <template #footer>
      <ui-button
        v-if="!isAddMode"
        type="button"
        variant="ghost"
        size="icon"
        class="size-11 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10 lg:size-9"
        :disabled="isSaving"
        aria-label="刪除"
        @click="handleDeleteClick"
      >
        <Icon name="lucide:trash-2" :size="16" />
      </ui-button>
      <ui-button
        type="button"
        variant="outline"
        class="h-11 flex-1 lg:h-9"
        :disabled="isSaving"
        @click="handleClose"
      >
        取消
      </ui-button>
      <ui-button
        type="button"
        class="h-11 flex-1 lg:h-9"
        :disabled="isSaving || !name.trim()"
        @click="handleSave"
      >
        <Icon v-if="isSaving" name="lucide:loader-2" class="animate-spin mr-2" :size="16" />
        {{ isSaving ? '儲存中...' : (isAddMode ? '新增' : '儲存') }}
      </ui-button>
    </template>
  </responsive-dialog>

  <confirmation-dialog
    v-model:open="showDeleteConfirm"
    title="確定要刪除此項目？"
    :description="item?.name ? `「${item.name}」將從明細中移除。` : '此項目將從明細中移除。'"
    confirm-label="確定刪除"
    confirm-variant="destructive"
    :is-loading="isSaving"
    @confirm="confirmDelete"
  />
</template>
