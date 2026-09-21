<script setup lang="ts">
import type { TripMember } from '@/types'
import { toast } from 'vue-sonner'
import { animalEmojis } from '@/constants'

const props = defineProps<{
  tripId: string
  member: TripMember
  members: TripMember[]
  showCancel?: boolean
}>()

const emit = defineEmits<{
  (e: 'saved'): void
  (e: 'cancel'): void
}>()

const name = ref(props.member.name)
const avatar = ref(props.member.avatarEmoji)
const isSubmitting = ref(false)

const availableEmojis = computed(() => {
  const usedEmojis = props.members
    .filter(m => m.id !== props.member.id)
    .map(m => m.avatarEmoji)
  return animalEmojis.filter(emoji => !usedEmojis.includes(emoji))
})

async function handleSave() {
  const trimmedName = name.value.trim()
  if (!trimmedName) {
    toast.error('請輸入名稱')
    return
  }

  try {
    isSubmitting.value = true
    await $fetch(`/api/trips/${props.tripId}/members/me`, {
      method: 'PATCH',
      body: { name: trimmedName, avatarEmoji: avatar.value },
    })
    toast.success('個人資料已更新')
    emit('saved')
  }
  catch (error: any) {
    console.error('Error updating member:', error)
    if (error.status === 409) {
      toast.error(error.data?.message || `「${trimmedName}」已被其他成員使用`)
    }
    else {
      toast.error(error.data?.message || '更新失敗，請稍後再試')
    }
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <form class="space-y-5" @submit.prevent="handleSave">
    <div class="flex items-center gap-4">
      <div class="size-16 flex items-center justify-center text-3xl bg-primary/10 border-2 border-primary/20 rounded-full shrink-0">
        {{ avatar }}
      </div>
      <div class="flex-1">
        <label for="member-profile-name" class="text-sm font-medium text-foreground mb-1.5 block">顯示名稱</label>
        <ui-input
          id="member-profile-name"
          v-model="name"
          type="text"
          placeholder="輸入你的名稱"
          class="h-12 text-base"
          :disabled="isSubmitting"
        />
      </div>
    </div>

    <!-- Avatar grid -->
    <div class="space-y-2">
      <label class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">選擇頭像</label>
      <div class="grid grid-cols-8 sm:grid-cols-10 gap-1.5">
        <button
          v-for="emoji in availableEmojis"
          :key="emoji"
          type="button"
          :class="{
            'bg-primary ring-2 ring-primary ring-offset-1': avatar === emoji,
            'bg-card hover:bg-muted': avatar !== emoji,
          }"
          class="aspect-square flex items-center justify-center text-xl rounded-lg border border-border transition-colors cursor-pointer"
          @click="avatar = emoji"
        >
          {{ emoji }}
        </button>
      </div>
    </div>

    <div class="flex gap-3 pt-1">
      <ui-button
        v-if="showCancel"
        type="button"
        variant="outline"
        class="flex-1"
        :disabled="isSubmitting"
        @click="emit('cancel')"
      >
        取消
      </ui-button>
      <ui-button
        type="submit"
        class="flex-1"
        :disabled="isSubmitting"
      >
        <Icon v-if="isSubmitting" name="lucide:loader-circle" :size="16" class="animate-spin mr-2" />
        {{ isSubmitting ? '儲存中...' : '儲存變更' }}
      </ui-button>
    </div>
  </form>
</template>
