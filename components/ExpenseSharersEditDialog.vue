<script setup lang="ts">
import type { TripMember } from '@/types'

const props = defineProps<{
  open: boolean
  tripMembers: TripMember[]
  sharedWithMemberIds: string[]
  isSaving?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
  (e: 'save', sharedWithMemberIds: string[]): void
}>()

const selected = ref<string[]>([])

const canSave = computed(() => selected.value.length > 0)

watch(() => props.open, (open) => {
  if (!open)
    return
  selected.value = [...props.sharedWithMemberIds]
}, { immediate: true })

function handleSave() {
  if (!canSave.value)
    return
  emit('save', [...selected.value])
}

function handleClose() {
  emit('update:open', false)
}
</script>

<template>
  <responsive-dialog
    :open="open"
    title="編輯分攤成員"
    description="選擇分攤這筆支出的成員"
    @update:open="(val) => emit('update:open', val)"
  >
    <div class="space-y-2">
      <member-picker
        v-model="selected"
        :members="tripMembers"
        multiple
        select-all
        label="分攤成員"
        :invalid="selected.length === 0"
      />
      <p v-if="selected.length === 0" role="alert" class="text-xs text-destructive">
        至少選擇一個分攤的成員
      </p>
    </div>

    <template #footer>
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
        :disabled="isSaving || !canSave"
        @click="handleSave"
      >
        <Icon v-if="isSaving" name="lucide:loader-2" class="animate-spin mr-2" :size="16" />
        {{ isSaving ? '儲存中...' : '儲存' }}
      </ui-button>
    </template>
  </responsive-dialog>
</template>
