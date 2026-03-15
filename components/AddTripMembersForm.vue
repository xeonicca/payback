<script setup lang="ts">
import type { NewTripMember } from '@/types'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import * as z from 'zod'
import { animalEmojis } from '@/constants'

const props = defineProps<{
  members: NewTripMember[]
  onMembersChange: (updatedMembers: NewTripMember[]) => void
}>()

const formSchema = z.object({
  name: z.string().min(1, '請輸入成員名稱'),
  avatar: z.string().min(1, '請選擇一個頭像'),
})

type FormValues = z.infer<typeof formSchema>

const form = useForm({
  validationSchema: toTypedSchema(formSchema),
  initialValues: {
    name: '',
    avatar: animalEmojis[0],
  },
})

const showAvatarPicker = ref(false)

// Compute available emojis (filter out already taken ones)
const availableEmojis = computed(() => {
  const usedEmojis = props.members.map(m => m.avatarEmoji)
  return animalEmojis.filter(emoji => !usedEmojis.includes(emoji))
})

// Non-host members in reverse order (newest first)
const nonHostMembers = computed(() => {
  return [...props.members].filter(m => !m.isHost).reverse()
})

const hostMember = computed(() => {
  return props.members.find(m => m.isHost)
})

// Update form avatar when available emojis change
watch(availableEmojis, (newAvailable) => {
  if (newAvailable.length > 0 && !newAvailable.includes(form.values.avatar)) {
    form.setFieldValue('avatar', newAvailable[0])
  }
}, { immediate: true })

const onSubmit = form.handleSubmit((values: FormValues) => {
  const trimmedName = values.name.trim()

  const nameExists = props.members.some(
    member => member.name.toLowerCase() === trimmedName.toLowerCase(),
  )
  if (nameExists) {
    toast.error(`「${trimmedName}」已經在成員列表中`)
    return
  }

  const newMember: NewTripMember = {
    name: trimmedName,
    avatarEmoji: values.avatar,
    createdAt: new Date() as any,
    spending: 0,
    isHost: false,
  }

  const updated = [...props.members, newMember]
  props.onMembersChange(updated)
  toast.success(`已新增「${trimmedName}」`)
  form.resetForm()
  showAvatarPicker.value = false

  // Set next available emoji
  const usedAvatars = updated.map(m => m.avatarEmoji)
  const nextAvailable = animalEmojis.find(e => !usedAvatars.includes(e))
  if (nextAvailable) {
    form.setFieldValue('avatar', nextAvailable)
  }
})

function handleRemoveMemberFromList(name: string) {
  const toRemove = props.members.find(m => m.name === name)
  const updated = props.members.filter(m => m.name !== name)
  props.onMembersChange(updated)
  if (toRemove)
    toast.success(`已移除「${toRemove.name}」`)
}

function selectAvatar(emoji: string) {
  form.setFieldValue('avatar', emoji)
  showAvatarPicker.value = false
}
</script>

<template>
  <div class="space-y-4">
    <!-- Members List (on top so new additions are visible) -->
    <div class="space-y-2">
      <!-- Host member (always first, not removable) -->
      <div
        v-if="hostMember"
        class="flex items-center gap-3 px-3 py-2.5 bg-indigo-50 border border-indigo-100 rounded-lg"
      >
        <div class="w-10 h-10 flex items-center justify-center bg-white rounded-full text-xl shrink-0">
          {{ hostMember.avatarEmoji }}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-gray-900 truncate m-0">
            {{ hostMember.name }}
          </p>
        </div>
        <ui-badge variant="default" class="text-xs shrink-0">
          <Icon name="lucide:crown" :size="12" class="mr-1" />
          你
        </ui-badge>
      </div>

      <!-- Other members (newest first) -->
      <div
        v-for="member in nonHostMembers"
        :key="member.name"
        class="flex items-center gap-3 px-3 py-2.5 bg-white border border-gray-200 rounded-lg"
      >
        <div class="w-10 h-10 flex items-center justify-center bg-gray-50 rounded-full text-xl shrink-0">
          {{ member.avatarEmoji }}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-gray-900 truncate m-0">
            {{ member.name }}
          </p>
        </div>
        <ui-button
          type="button"
          variant="ghost"
          size="icon"
          class="shrink-0 w-8 h-8 text-gray-400 hover:text-red-600 hover:bg-red-50"
          @click="handleRemoveMemberFromList(member.name)"
        >
          <Icon name="lucide:x" :size="16" />
        </ui-button>
      </div>
    </div>

    <!-- Add Member Form (compact, below the list) -->
    <form class="space-y-3 p-4 bg-gray-50 border border-dashed border-gray-300 rounded-lg" @submit.prevent="onSubmit">
      <div class="flex items-start gap-2">
        <!-- Avatar picker toggle -->
        <button
          type="button"
          class="w-12 h-12 flex items-center justify-center text-2xl bg-white border-2 rounded-lg shrink-0 transition-colors"
          :class="showAvatarPicker ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'"
          @click="showAvatarPicker = !showAvatarPicker"
        >
          {{ form.values.avatar }}
        </button>

        <!-- Name input + submit in one row -->
        <ui-form-field v-slot="{ componentField }" name="name" class="flex-1">
          <ui-form-item class="space-y-0">
            <ui-form-control>
              <ui-input
                v-bind="componentField"
                type="text"
                placeholder="輸入成員名稱"
                class="h-12 text-base"
              />
            </ui-form-control>
            <ui-form-message />
          </ui-form-item>
        </ui-form-field>

        <ui-button
          type="submit"
          size="icon"
          class="w-12 h-12 shrink-0"
          :disabled="availableEmojis.length === 0"
        >
          <Icon name="lucide:plus" :size="20" />
        </ui-button>
      </div>

      <!-- Avatar grid (expandable) -->
      <div v-if="showAvatarPicker" class="space-y-2">
        <p class="text-xs text-gray-500 m-0">
          點擊選擇頭像
        </p>
        <div class="grid grid-cols-8 sm:grid-cols-10 gap-1.5">
          <button
            v-for="emoji in availableEmojis"
            :key="emoji"
            type="button"
            :class="{
              'bg-indigo-500 ring-2 ring-indigo-500 ring-offset-1': form.values.avatar === emoji,
              'bg-white hover:bg-gray-100': form.values.avatar !== emoji,
            }"
            class="aspect-square flex items-center justify-center text-xl rounded-lg border border-gray-200 transition-all cursor-pointer"
            @click="selectAvatar(emoji)"
          >
            {{ emoji }}
          </button>
        </div>
        <p v-if="availableEmojis.length === 0" class="text-sm text-amber-600 text-center py-2">
          所有頭像已被使用，如需更多成員請先移除再重新分配
        </p>
      </div>
    </form>
  </div>
</template>
