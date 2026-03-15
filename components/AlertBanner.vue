<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'error' | 'info' | 'warning'
  icon?: string
  title?: string
}>(), {
  variant: 'info',
})

const variantClasses: Record<string, { container: string, icon: string, title: string, body: string }> = {
  error: {
    container: 'bg-red-50 border-red-200',
    icon: 'text-red-600',
    title: 'text-red-900',
    body: 'text-red-700',
  },
  info: {
    container: 'bg-blue-50 border-blue-200',
    icon: 'text-blue-600',
    title: 'text-blue-900',
    body: 'text-blue-700',
  },
  warning: {
    container: 'bg-amber-50 border-amber-200',
    icon: 'text-amber-600',
    title: 'text-amber-900',
    body: 'text-amber-700',
  },
}
</script>

<template>
  <div class="p-4 border rounded-lg" :class="variantClasses[variant].container">
    <div class="flex items-start gap-3">
      <Icon
        v-if="icon"
        :name="icon"
        class="w-5 h-5 mt-0.5 shrink-0"
        :class="variantClasses[variant].icon"
      />
      <div class="flex-1">
        <p v-if="title" class="text-sm font-medium m-0 mb-1" :class="variantClasses[variant].title">
          {{ title }}
        </p>
        <div class="text-sm m-0" :class="variantClasses[variant].body">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>
