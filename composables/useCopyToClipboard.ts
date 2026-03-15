import { toast } from 'vue-sonner'

export function useCopyToClipboard() {
  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('已複製到剪貼簿')
    }
    catch {
      toast.error('複製失敗')
    }
  }

  return { copyToClipboard }
}
