<script setup lang="ts">
import { computed } from 'vue'

interface ExpenseItem {
  name: string
  price: number
  quantity?: number
  translatedName?: string
  sharedByMemberId?: string[]
}

interface Props {
  item: ExpenseItem
  currency: string
  editMode?: boolean
  tripMembers?: Array<{
    id: string
    name: string
    avatarEmoji: string
  }>
  exchangeRate?: number
  defaultCurrency?: string
}

const props = withDefaults(defineProps<Props>(), {
  editMode: false,
  tripMembers: () => [],
  exchangeRate: 1,
  defaultCurrency: 'TWD',
})

const emit = defineEmits<{
  (e: 'update:sharedByMemberId', memberIds: string[]): void
}>()

const selectedMemberIds = ref<string[]>(props.item.sharedByMemberId || [])

function handleMemberToggle(memberId: string) {
  const newSelection = selectedMemberIds.value.includes(memberId)
    ? selectedMemberIds.value.filter(id => id !== memberId)
    : [...selectedMemberIds.value, memberId]

  selectedMemberIds.value = newSelection
  emit('update:sharedByMemberId', newSelection)
}

const convertedPrice = computed(() => {
  if (!props.exchangeRate || props.exchangeRate === 1)
    return null
  return Math.round(props.item.price * props.exchangeRate * 100) / 100
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
        分攤成員
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
