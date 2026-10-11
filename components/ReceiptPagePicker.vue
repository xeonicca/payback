<script setup lang="ts">
import { toast } from 'vue-sonner'
import { appendPages, MAX_RECEIPT_PAGES } from '@/utils/receiptPages'

const props = withDefaults(defineProps<{
  /** Unique per breakpoint — the desktop and mobile drawers both render one. */
  id: string
  max?: number
}>(), {
  max: MAX_RECEIPT_PAGES,
})

const pages = defineModel<File[]>({ default: () => [] })

const input = ref<HTMLInputElement | null>(null)

function openPicker() {
  input.value?.click()
}

function onChange(event: Event) {
  const element = event.target as HTMLInputElement
  const incoming = Array.from(element.files ?? [])
  // Clear the input so re-picking the same photo still fires `change`.
  element.value = ''
  if (incoming.length === 0) {
    return
  }

  const { pages: next, rejected } = appendPages(pages.value, incoming, props.max)
  pages.value = next

  if (rejected > 0) {
    toast.error(`最多 ${props.max} 頁`)
  }
}

function removePage(index: number) {
  pages.value = pages.value.filter((_, i) => i !== index)
}
</script>

<template>
  <div class="grid w-full items-center gap-1.5">
    <ui-label :for="id">
      上傳收據（僅支援圖片格式）
    </ui-label>

    <input
      :id="id"
      ref="input"
      type="file"
      accept="image/*"
      multiple
      class="hidden"
      @change="onChange"
    >

    <ui-button
      v-if="pages.length === 0"
      type="button"
      variant="outline"
      class="w-full justify-center border-dashed h-20"
      @click="openPicker"
    >
      <Icon name="lucide:camera" class="w-4 h-4 mr-2" />
      選擇收據圖片
    </ui-button>

    <template v-else>
      <ul class="space-y-1">
        <li
          v-for="(page, index) in pages"
          :key="`${page.name}-${page.size}-${page.lastModified}`"
          class="flex items-center gap-2 rounded-md border bg-card px-3 py-2"
        >
          <span class="text-xs font-medium text-muted-foreground whitespace-nowrap">
            第 {{ index + 1 }} 頁
          </span>
          <span class="flex-1 text-xs truncate">{{ page.name }}</span>
          <ui-button
            type="button"
            variant="ghost"
            size="icon"
            class="h-7 w-7 shrink-0"
            :aria-label="`移除第 ${index + 1} 頁`"
            @click="removePage(index)"
          >
            <Icon name="lucide:x" :size="14" />
          </ui-button>
        </li>
      </ul>

      <ui-button
        v-if="pages.length < max"
        type="button"
        variant="outline"
        class="w-full justify-center border-dashed"
        @click="openPicker"
      >
        <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
        新增頁面
      </ui-button>

      <p class="text-xs text-muted-foreground">
        共 {{ pages.length }} 頁 · 依新增順序辨識；拍攝時請與上一張稍微重疊
      </p>
    </template>
  </div>
</template>
