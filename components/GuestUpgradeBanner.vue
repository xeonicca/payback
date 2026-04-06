<script setup lang="ts">
import { toast } from 'vue-sonner'

const props = defineProps<{
  tripId?: string
}>()

const { upgradeGuestAccount } = useLogin()
const sessionUser = useSessionUser()
const isUpgrading = ref(false)

async function handleUpgrade() {
  try {
    isUpgrading.value = true
    const user = await upgradeGuestAccount()

    if (!user) {
      // Redirect-based flow (production) — will be handled on return
      return
    }

    // Update collaborator records on the server
    if (props.tripId) {
      await $fetch('/api/auth/upgrade', {
        method: 'POST',
        body: { tripId: props.tripId },
      })
    }

    toast.success('帳號已成功連結！')
  }
  catch (error: any) {
    console.error('Error upgrading guest account:', error)
    toast.error('連結帳號失敗，請稍後再試')
  }
  finally {
    isUpgrading.value = false
  }
}
</script>

<template>
  <div v-if="sessionUser?.isAnonymous" class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3">
    <Icon name="lucide:info" class="w-4 h-4 text-amber-600 shrink-0" />
    <p class="text-sm text-amber-800 m-0 flex-1">
      你目前以訪客身份使用，連結 Google 帳號可保留資料
    </p>
    <ui-button
      size="sm"
      variant="outline"
      :disabled="isUpgrading"
      class="shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100"
      @click="handleUpgrade"
    >
      <Icon v-if="isUpgrading" name="lucide:loader-circle" class="w-4 h-4 mr-1 animate-spin" />
      <Icon v-else name="lucide:link" class="w-4 h-4 mr-1" />
      連結帳號
    </ui-button>
  </div>
</template>
