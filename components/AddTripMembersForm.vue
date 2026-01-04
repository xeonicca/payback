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
  name: z.string().min(1, 'Member name cannot be empty'),
  avatar: z.string().min(1, 'Please select an avatar for the member'),
})

type FormValues = z.infer<typeof formSchema>

const form = useForm({
  validationSchema: toTypedSchema(formSchema),
  initialValues: {
    name: '',
    avatar: animalEmojis[0],
  },
})

// Compute available emojis (filter out already taken ones)
const availableEmojis = computed(() => {
  const usedEmojis = props.members.map(m => m.avatarEmoji)
  return animalEmojis.filter(emoji => !usedEmojis.includes(emoji))
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
    toast.error(`Member name "${trimmedName}" already exists.`)
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
  toast.success(`Added ${trimmedName} to the trip`)
  form.resetForm()

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
    toast.success(`Removed ${toRemove.name} from the trip`)
}

function selectAvatar(emoji: string) {
  form.setFieldValue('avatar', emoji)
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h3 class="m-0 text-lg font-semibold text-gray-700">
        行程成員
      </h3>
      <ui-badge variant="secondary" class="text-xs">
        {{ members.length }} 位成員
      </ui-badge>
    </div>

    <!-- Add Member Form -->
    <form class="space-y-4 p-6 bg-white border border-gray-200 rounded-xl shadow-sm" @submit.prevent="onSubmit">
      <!-- Name Input -->
      <ui-form-field v-slot="{ componentField }" name="name">
        <ui-form-item>
          <ui-form-label class="text-sm font-semibold text-gray-700">成員名稱</ui-form-label>
          <ui-form-control>
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Icon name="lucide:user" :size="18" class="text-gray-400" />
              </div>
              <ui-input
                v-bind="componentField"
                type="text"
                placeholder="輸入成員名稱..."
                class="pl-10 h-12 text-base"
              />
            </div>
          </ui-form-control>
          <ui-form-message />
        </ui-form-item>
      </ui-form-field>

      <!-- Avatar Selector -->
      <ui-form-field v-slot="{ componentField }" name="avatar">
        <ui-form-item>
          <ui-form-label class="text-sm font-semibold text-gray-700 mb-3 block">
            選擇頭像
            <span class="text-xs font-normal text-gray-500 ml-2">(點擊選擇)</span>
          </ui-form-label>
          <ui-form-control>
            <div class="space-y-3">
              <!-- Selected Avatar Preview -->
              <div class="flex items-center gap-3 p-4 bg-indigo-50 border-2 border-indigo-200 rounded-lg">
                <div class="text-4xl">{{ form.values.avatar }}</div>
                <div class="flex-1">
                  <p class="text-sm font-medium text-gray-700 m-0">已選擇頭像</p>
                  <p class="text-xs text-gray-500 m-0">點擊下方圖示更換</p>
                </div>
              </div>

              <!-- Avatar Grid -->
              <div class="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200 max-h-48 overflow-y-auto">
                <button
                  v-for="emoji in availableEmojis"
                  :key="emoji"
                  type="button"
                  :class="{
                    'bg-indigo-500 ring-2 ring-indigo-500 ring-offset-2 scale-110': form.values.avatar === emoji,
                    'bg-white hover:bg-gray-100 hover:scale-105': form.values.avatar !== emoji,
                  }"
                  class="aspect-square flex items-center justify-center text-2xl rounded-lg border border-gray-200 transition-all cursor-pointer"
                  @click="selectAvatar(emoji)"
                >
                  {{ emoji }}
                </button>
              </div>

              <p v-if="availableEmojis.length === 0" class="text-sm text-amber-600 text-center py-2">
                所有頭像已被使用
              </p>
            </div>
          </ui-form-control>
          <ui-form-message />
        </ui-form-item>
      </ui-form-field>

      <!-- Submit Button -->
      <ui-button
        type="submit"
        class="w-full h-12 text-base font-semibold"
        :disabled="availableEmojis.length === 0"
      >
        <Icon name="lucide:user-plus" :size="20" class="mr-2" />
        新增成員
      </ui-button>
    </form>

    <!-- Members List -->
    <div v-if="members.length > 0" class="space-y-3">
      <h4 class="text-sm font-semibold text-gray-700 px-2">
        成員列表
      </h4>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div
          v-for="member in members"
          :key="member.name"
          class="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl hover:shadow-md transition-shadow"
        >
          <!-- Avatar -->
          <div class="w-14 h-14 flex items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50 rounded-full text-3xl shrink-0">
            {{ member.avatarEmoji }}
          </div>

          <!-- Member Info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <p class="text-base font-semibold text-gray-900 truncate m-0">
                {{ member.name }}
              </p>
              <ui-badge v-if="member.isHost" variant="default" class="text-xs shrink-0">
                <Icon name="lucide:crown" :size="12" class="mr-1" />
                主辦人
              </ui-badge>
            </div>
            <p class="text-xs text-gray-500 m-0">
              行程成員
            </p>
          </div>

          <!-- Remove Button -->
          <ui-button
            v-if="!member.isHost"
            type="button"
            variant="ghost"
            size="icon"
            class="shrink-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
            @click="handleRemoveMemberFromList(member.name)"
          >
            <Icon name="lucide:trash-2" :size="18" />
          </ui-button>
          <div v-else class="w-10 h-10 shrink-0" />
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="text-center py-8 px-4 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
      <div class="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-3">
        <Icon name="lucide:users" class="w-8 h-8 text-gray-400" />
      </div>
      <p class="text-sm font-medium text-gray-700 mb-1">
        尚未新增成員
      </p>
      <p class="text-xs text-gray-500">
        請在上方表單新增行程成員
      </p>
    </div>
  </div>
</template>
