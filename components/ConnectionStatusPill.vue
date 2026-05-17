<script setup lang="ts">
const { state } = useConnectionState()
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-200"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition-opacity duration-200"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="state !== 'online'"
      :class="[
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
        state === 'offline'
          ? 'bg-amber-100 text-amber-900'
          : 'bg-slate-200 text-slate-700',
      ]"
      role="status"
      :aria-label="state === 'offline' ? 'Offline' : 'Syncing'"
    >
      <span
        v-if="state === 'offline'"
        class="w-2 h-2 rounded-full bg-amber-500"
        aria-hidden="true"
      />
      <span
        v-else
        class="w-3 h-3 inline-block animate-spin border-2 border-slate-400 border-t-transparent rounded-full"
        aria-hidden="true"
      />
      <span>{{ state === 'offline' ? 'Offline' : 'Syncing…' }}</span>
    </div>
  </Transition>
</template>
