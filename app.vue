<script setup lang="ts">
import { toast } from 'vue-sonner'
import 'vue-sonner/style.css' // vue-sonner v2 requires this import

const { $pwa } = useNuxtApp()

onMounted(() => {
  if ($pwa.needRefresh) {
    toast.success('App ready to work offline', {
      action: {
        label: 'Undo',
        onClick: () => $pwa.updateServiceWorker(),
      },
    })
  }
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
    <NuxtPwaManifest />
  </NuxtLayout>
  <toaster />
</template>
