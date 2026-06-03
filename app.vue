<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Toaster } from '@/components/ui/sonner'
import 'vue-sonner/style.css'

const { $pwa } = useNuxtApp()

const FIVE_MINUTES_MS = 5 * 60 * 1000
let lastUpdateCheck = Date.now()

let updateToastId: string | number | undefined
watch(
  () => $pwa?.needRefresh && unref($pwa.needRefresh),
  (val) => {
    if (!val || updateToastId !== undefined)
      return
    updateToastId = toast('Update available', {
      description: 'A new version of the app is ready.',
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: 'Update',
        onClick: () => {
          $pwa!.updateServiceWorker()
        },
      },
    })
  },
  { immediate: true },
)

if (import.meta.client && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateToastId !== undefined) {
      toast.dismiss(updateToastId)
      updateToastId = undefined
    }
    toast.success('Updated to latest version')
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible')
      return
    const now = Date.now()
    if (now - lastUpdateCheck < FIVE_MINUTES_MS)
      return
    lastUpdateCheck = now
    const pwa = $pwa as unknown as { update?: () => Promise<void> } | undefined
    void pwa?.update?.()
  })
}
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
    <NuxtPwaManifest />
  </NuxtLayout>

  <toaster position="top-center" style="top: calc(8px + env(safe-area-inset-top, 0px))" />
</template>
