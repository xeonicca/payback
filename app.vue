<script setup lang="ts">
const { $pwa } = useNuxtApp()
const showUpdateDialog = ref(false)

onMounted(() => {
  if ($pwa!.needRefresh) {
    showUpdateDialog.value = true
  }
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
    <NuxtPwaManifest />
  </NuxtLayout>

  <ui-alert-dialog v-model:open="showUpdateDialog">
    <ui-alert-dialog-content>
      <ui-alert-dialog-header>
        <ui-alert-dialog-title>App Update Available</ui-alert-dialog-title>
        <ui-alert-dialog-description>
          A new version of the app is available.
        </ui-alert-dialog-description>
      </ui-alert-dialog-header>
      <ui-alert-dialog-footer>
        <ui-alert-dialog-action @click="$pwa!.updateServiceWorker()">
          Update Now
        </ui-alert-dialog-action>
      </ui-alert-dialog-footer>
    </ui-alert-dialog-content>
  </ui-alert-dialog>
</template>
