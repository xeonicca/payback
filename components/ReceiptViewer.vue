<script setup lang="ts">
import type { PanzoomObject } from '@panzoom/panzoom'

const props = withDefaults(defineProps<{
  open: boolean
  src: string
  alt?: string
}>(), {
  alt: '收據圖片',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const stage = ref<HTMLDivElement | null>(null)
const image = ref<HTMLImageElement | null>(null)
const isLoading = ref(false)
const hasError = ref(false)

let panzoom: PanzoomObject | null = null
let prefersReducedMotion = false

function close() {
  emit('update:open', false)
}

function onWheel(event: WheelEvent) {
  if (!panzoom)
    return
  panzoom.zoomWithWheel(event)
}

let lastTapTime = 0
let lastTapX = 0
let lastTapY = 0
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30

function toggleZoom(clientX: number, clientY: number) {
  if (!panzoom)
    return
  const current = panzoom.getScale()
  if (current > 1.01) {
    panzoom.reset()
  }
  else {
    // zoomToPoint expects a MouseEvent-like; synthesize the minimum it needs
    panzoom.zoomToPoint(2, { clientX, clientY } as MouseEvent)
  }
}

function onDoubleClick(event: MouseEvent) {
  toggleZoom(event.clientX, event.clientY)
}

function onPointerUp(event: PointerEvent) {
  if (event.pointerType !== 'touch')
    return
  const now = event.timeStamp
  const dt = now - lastTapTime
  const dx = event.clientX - lastTapX
  const dy = event.clientY - lastTapY
  if (dt < DOUBLE_TAP_MS && Math.hypot(dx, dy) < DOUBLE_TAP_PX) {
    toggleZoom(event.clientX, event.clientY)
    lastTapTime = 0
  }
  else {
    lastTapTime = now
    lastTapX = event.clientX
    lastTapY = event.clientY
  }
}

function destroyPanzoom() {
  if (!panzoom)
    return
  panzoom.destroy()
  panzoom = null
  stage.value?.removeEventListener('wheel', onWheel)
  stage.value?.removeEventListener('dblclick', onDoubleClick)
  stage.value?.removeEventListener('pointerup', onPointerUp)
}

function fitImageToStage() {
  if (!image.value || !stage.value)
    return
  const { width: sw, height: sh } = stage.value.getBoundingClientRect()
  const nw = image.value.naturalWidth
  const nh = image.value.naturalHeight
  if (!nw || !nh || !sw || !sh)
    return
  const fit = Math.min(sw / nw, sh / nh)
  image.value.style.width = `${nw * fit}px`
  image.value.style.height = `${nh * fit}px`
}

async function initPanzoom() {
  if (!image.value || !stage.value)
    return
  if (panzoom)
    destroyPanzoom()

  fitImageToStage()

  const { default: createPanzoom } = await import('@panzoom/panzoom')

  if (!image.value || !stage.value)
    return

  panzoom = createPanzoom(image.value, {
    maxScale: 8,
    minScale: 1,
    step: 0.3,
    animate: !prefersReducedMotion,
    cursor: 'grab',
  })

  stage.value.addEventListener('wheel', onWheel, { passive: false })
  stage.value.addEventListener('dblclick', onDoubleClick)
  stage.value.addEventListener('pointerup', onPointerUp)
}

function onImageLoad() {
  isLoading.value = false
  hasError.value = false
  nextTick(() => initPanzoom())
}

function onImageError() {
  isLoading.value = false
  hasError.value = true
}

watch(() => props.open, (open) => {
  if (open) {
    isLoading.value = true
    hasError.value = false
    if (typeof window !== 'undefined') {
      prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }
  }
  else {
    destroyPanzoom()
  }
})

onBeforeUnmount(() => {
  destroyPanzoom()
})
</script>

<template>
  <ui-dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <ui-dialog-content
      :show-close-button="false"
      class="!fixed !inset-0 !top-0 !left-0 !translate-x-0 !translate-y-0 !max-w-none !w-screen !h-dvh !rounded-none !border-0 !p-0 !bg-black/95 !gap-0"
    >
      <ui-dialog-title class="sr-only">
        收據圖片
      </ui-dialog-title>
      <ui-dialog-description class="sr-only">
        使用手指縮放或滑鼠滾輪縮放收據圖片，可拖曳查看細節。
      </ui-dialog-description>

      <button
        type="button"
        aria-label="關閉"
        class="absolute z-10 top-safe right-3 mt-3 inline-flex items-center justify-center rounded-full bg-white/10 text-white w-10 h-10 backdrop-blur hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50 transition-colors"
        @click="close"
      >
        <Icon name="lucide:x" :size="20" />
      </button>

      <div
        v-if="isLoading"
        class="absolute inset-0 flex items-center justify-center text-white pointer-events-none"
      >
        <Icon name="lucide:loader-2" :size="32" class="animate-spin" />
      </div>

      <div
        v-if="hasError"
        class="absolute inset-0 flex items-center justify-center text-white text-sm"
      >
        無法載入圖片
      </div>

      <div
        ref="stage"
        class="w-screen h-dvh overflow-hidden touch-none select-none overscroll-contain flex items-center justify-center"
      >
        <img
          ref="image"
          :src="src"
          :alt="alt"
          class="block w-auto h-auto max-w-screen max-h-dvh"
          draggable="false"
          @load="onImageLoad"
          @error="onImageError"
        >
      </div>
    </ui-dialog-content>
  </ui-dialog>
</template>
