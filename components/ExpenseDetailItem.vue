<script setup lang="ts">
import type { ExpenseDetailItem } from '@/types'

interface Props {
  item: ExpenseDetailItem
  currency: string
  editMode?: boolean
  tripMembers?: Array<{
    id: string
    name: string
    avatarEmoji: string
  }>
  exchangeRate?: number
  defaultCurrency?: string
  sharedByMemberIds?: string[]
  shareableMembers: Array<{
    id: string
    name: string
    avatarEmoji: string
  }>
}

const props = withDefaults(defineProps<Props>(), {
  editMode: false,
  tripMembers: () => [],
  exchangeRate: 1,
  defaultCurrency: 'TWD',
  sharedByMemberIds: () => [],
})

const emit = defineEmits<{
  (e: 'update:sharedByMemberIds', memberIds: string[]): void
}>()

// When sharedByMemberIds is empty/undefined, all members are selected
// When it has values, only those specific members are selected
const selectedMemberIds = computed({
  get: () => {
    // If sharedByMemberIds is empty/undefined, return all member IDs (meaning all members share)
    if (!props.sharedByMemberIds || props.sharedByMemberIds.length === 0) {
      return props.tripMembers.map(member => member.id)
    }
    // Otherwise return the specific selected member IDs
    return props.sharedByMemberIds
  },
  set: (newSelection: string[]) => {
    // If all members are selected, emit empty array (meaning all members share)
    if (newSelection.length === props.tripMembers.length) {
      emit('update:sharedByMemberIds', [])
    }
    else {
      // Otherwise emit the specific selected member IDs
      emit('update:sharedByMemberIds', newSelection)
    }
  },
})

function handleMemberToggle(memberId: string) {
  const currentSelection = selectedMemberIds.value
  const newSelection = currentSelection.includes(memberId)
    ? currentSelection.filter(id => id !== memberId)
    : [...currentSelection, memberId]

  selectedMemberIds.value = newSelection
}

const convertedPrice = computed(() => {
  if (!props.exchangeRate || props.exchangeRate === 1)
    return null
  return Math.round(props.item.price * props.exchangeRate * 100) / 100
})

const sharedByMemberAvatars = computed(() => {
  if (!props.sharedByMemberIds || props.sharedByMemberIds.length === 0)
    return props.shareableMembers.map(member => member.avatarEmoji)
  return props.shareableMembers.filter(member => props.sharedByMemberIds?.includes(member.id)).map(member => member.avatarEmoji)
})
</script>

<template>
  <div class="flex flex-wrap items-start justify-between py-3 border-b border-gray-100 last:border-b-0">
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="font-medium text-sm">{{ item.name }}</span>
        <span v-if="item.quantity" class="font-mono text-xs text-gray-500">x{{ item.quantity }}</span>
      </div>
      <p v-if="item.translatedName" class="text-xs text-gray-500 mt-1">
        翻譯: {{ item.translatedName }}
      </p>
      <div v-if="!editMode" class="flex items-center gap-1">
        <span v-for="memberAvatar in sharedByMemberAvatars" :key="memberAvatar">
          {{ memberAvatar }}
        </span>
      </div>
    </div>
    <div class="text-right font-mono text-sm ml-4">
      <div class="text-green-600">
        {{ currency }} {{ item.price }}
      </div>
      <div v-if="convertedPrice" class="text-xs text-gray-500 inline-flex items-center gap-1">
        <Icon name="lucide:equal-approximately" class="text-gray-500" size="12" />
        {{ defaultCurrency }} {{ convertedPrice }}
      </div>
    </div>

    <!-- Member selection section when in edit mode -->
    <div v-if="editMode && tripMembers.length > 0" class="mt-3 w-full space-y-2 bg-slate-200 rounded-lg p-2">
      <p class="text-xs text-gray-600 font-medium">
        明細分攤成員
      </p>
      <div class="flex flex-wrap gap-2">
        <div
          v-for="member in tripMembers"
          :key="member.id"
          class="flex items-center gap-2 cursor-pointer"
        >
          <ui-checkbox
            :id="`member-${item.name}-${member.id}`"
            class="bg-white"
            :model-value="selectedMemberIds.includes(member.id)"
            @update:model-value="handleMemberToggle(member.id)"
          />
          <ui-label :for="`member-${item.name}-${member.id}`" class="text-xs cursor-pointer">
            {{ member.avatarEmoji }} {{ member.name }}
          </ui-label>
        </div>
      </div>
    </div>
  </div>
</template>
