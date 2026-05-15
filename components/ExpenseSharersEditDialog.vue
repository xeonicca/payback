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

const allSelected = computed(() =>
  selected.value.length === props.tripMembers.length && props.tripMembers.length > 0,
)

const canSave = computed(() => selected.value.length > 0)

watch(() => props.open, (open) => {
  if (!open)
    return
  selected.value = [...props.sharedWithMemberIds]
}, { immediate: true })

function toggle(memberId: string) {
  selected.value = selected.value.includes(memberId)
    ? selected.value.filter(id => id !== memberId)
    : [...selected.value, memberId]
}

function toggleAll() {
  selected.value = allSelected.value ? [] : props.tripMembers.map(m => m.id)
}

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
  <ui-dialog :open="open" @update:open="(val) => emit('update:open', val)">
    <ui-dialog-content class="max-w-md" @open-auto-focus.prevent>
      <ui-dialog-header>
        <ui-dialog-title>編輯分攤成員</ui-dialog-title>
        <ui-dialog-description class="text-xs text-muted-foreground">
          選擇分攤這筆支出的成員
        </ui-dialog-description>
      </ui-dialog-header>

      <div class="space-y-2 py-2">
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
          v-for="member in tripMembers"
          :key="member.id"
          class="flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors hover:bg-slate-50"
          :class="selected.includes(member.id) ? 'border-indigo-200 bg-indigo-50/50' : 'border-transparent'"
          @click="toggle(member.id)"
        >
          <ui-checkbox
            :model-value="selected.includes(member.id)"
            @click.stop
            @update:model-value="toggle(member.id)"
          />
          <member-avatar :emoji="member.avatarEmoji" size="sm" />
          <span class="text-sm font-medium text-foreground flex-1">{{ member.name }}</span>
        </div>
        <p v-if="selected.length === 0" class="text-xs text-destructive pt-1">
          至少選擇一個分攤的成員
        </p>
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
          :disabled="isSaving || !canSave"
          @click="handleSave"
        >
          <Icon v-if="isSaving" name="lucide:loader-2" class="animate-spin mr-2" :size="16" />
          {{ isSaving ? '儲存中...' : '儲存' }}
        </ui-button>
      </ui-dialog-footer>
    </ui-dialog-content>
  </ui-dialog>
</template>
