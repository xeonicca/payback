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
}>()

const name = ref('')
const priceRaw = ref('')
const quantity = ref(1)
const translatedName = ref('')
const sharedByMemberIds = ref<string[]>([])

const price = computed(() => {
  const n = parseFloat(priceRaw.value)
  return isNaN(n) ? 0 : n
})

watch(() => props.item, (item) => {
  if (!item)
    return
  name.value = item.name
  priceRaw.value = String(item.price)
  quantity.value = item.quantity ?? 1
  translatedName.value = item.translatedName ?? ''
  sharedByMemberIds.value = [...(item.sharedByMemberIds ?? [])]
}, { immediate: true })

// When sharedByMemberIds is [], all members share (same convention as edit.vue)
const effectiveSharedIds = computed(() =>
  sharedByMemberIds.value.length === 0
    ? props.shareableMembers.map(m => m.id)
    : sharedByMemberIds.value,
)

const allSelected = computed(() =>
  sharedByMemberIds.value.length === props.shareableMembers.length && props.shareableMembers.length > 0,
)

function toggleMember(memberId: string) {
  const current = effectiveSharedIds.value
  const newIds = current.includes(memberId)
    ? current.filter(id => id !== memberId)
    : [...current, memberId]
  // Store empty array if all selected (means "all members share" by convention)
  sharedByMemberIds.value = newIds.length === props.shareableMembers.length ? [] : newIds
}

function toggleAll() {
  sharedByMemberIds.value = allSelected.value ? [] : props.shareableMembers.map(m => m.id)
}

function handleOpenChange(val: boolean) {
  emit('update:open', val)
}

function handleClose() {
  emit('update:open', false)
}

function handleSave() {
  if (props.itemIndex === null)
    return
  emit('save', props.itemIndex, {
    name: name.value,
    price: price.value,
    quantity: quantity.value,
    ...(translatedName.value ? { translatedName: translatedName.value } : {}),
    sharedByMemberIds: sharedByMemberIds.value,
  })
}
</script>

<template>
  <ui-dialog :open="open" @update:open="handleOpenChange">
    <ui-dialog-content class="max-w-md" @open-auto-focus.prevent>
      <ui-dialog-header>
        <ui-dialog-title>編輯明細項目</ui-dialog-title>
      </ui-dialog-header>

      <div class="space-y-4 py-2">
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
          <div class="space-y-1 rounded-xl border p-1">
            <!-- Select all -->
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
            <!-- Member rows -->
            <div
              v-for="member in shareableMembers"
              :key="member.id"
              class="flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors hover:bg-slate-50"
              :class="effectiveSharedIds.includes(member.id) && sharedByMemberIds.length > 0 ? 'border-indigo-200 bg-indigo-50/50' : 'border-transparent'"
              @click="toggleMember(member.id)"
            >
              <ui-checkbox
                :model-value="effectiveSharedIds.includes(member.id) && sharedByMemberIds.length > 0"
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
          :disabled="isSaving"
          @click="handleClose"
        >
          取消
        </ui-button>
        <ui-button
          type="button"
          class="flex-1"
          :disabled="isSaving || !name.trim()"
          @click="handleSave"
        >
          <Icon v-if="isSaving" name="lucide:loader-2" class="animate-spin mr-2" :size="16" />
          {{ isSaving ? '儲存中...' : '儲存' }}
        </ui-button>
      </ui-dialog-footer>
    </ui-dialog-content>
  </ui-dialog>
</template>
