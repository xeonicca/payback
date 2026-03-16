<script setup lang="ts">
const isVisible = ref(false)

function handleScroll() {
  isVisible.value = window.scrollY > 400
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-200"
    leave-active-class="transition-opacity duration-200"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <button
      v-if="isVisible"
      class="fixed right-4 bottom-safe-offset-24 lg:bottom-safe-offset-56 z-10 size-10 rounded-full bg-card border border-border shadow-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:shadow-lg transition-all duration-200"
      aria-label="回到頂部"
      @click="scrollToTop"
    >
      <Icon name="lucide:arrow-up" class="w-4 h-4" />
    </button>
  </Transition>
</template>
