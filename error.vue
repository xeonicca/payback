<script setup lang="ts">
const props = defineProps<{
  error: {
    statusCode: number
    statusMessage?: string
    message?: string
  }
}>()

function handleError() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <div class="min-h-svh bg-slate-200 flex items-center justify-center p-6">
    <div class="w-full max-w-md bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
      <div class="flex flex-col items-center justify-center space-y-5 text-center">
        <div class="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center">
          <span class="text-3xl font-bold text-red-500">{{ error.statusCode }}</span>
        </div>
        <div class="space-y-2">
          <h1 class="text-xl font-bold text-gray-900 m-0 tracking-tight">
            {{ error.statusCode === 404 ? '找不到頁面' : '發生錯誤' }}
          </h1>
          <p class="text-sm text-gray-500 m-0 leading-relaxed">
            {{ error.statusCode === 404 ? '此頁面不存在或已被移除' : '請重新整理頁面或返回首頁' }}
          </p>
        </div>
        <button
          class="inline-flex items-center justify-center rounded-md bg-gray-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
          @click="handleError"
        >
          返回首頁
        </button>
      </div>
    </div>
  </div>
</template>
