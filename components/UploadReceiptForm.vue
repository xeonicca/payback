<script setup lang="ts">
import type { NewExpense, Trip, TripMember } from '@/types'
import { toTypedSchema } from '@vee-validate/zod'
import { addDoc, collection, serverTimestamp, updateDoc } from 'firebase/firestore'
import { getDownloadURL, getStorage, ref as storageRef, uploadBytes } from 'firebase/storage'
import { useForm } from 'vee-validate'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { useFirestore } from 'vuefire'
import { z } from 'zod'

const props = defineProps<{
  trip: Trip
  tripMembers: TripMember[]
  hostMember?: TripMember
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const isUploading = ref(false)
const selectedFile = ref<File | null>(null)

const formSchema = toTypedSchema(z.object({
  paidByMemberId: z.string(),
  sharedWithMemberIds: z.array(z.string()).refine(value => value.some(item => item), {
    message: '至少選擇一個人',
  }),
}))

const { handleSubmit } = useForm({
  validationSchema: formSchema,
  initialValues: {
    sharedWithMemberIds: props.hostMember?.id ? [props.hostMember.id] : [],
    paidByMemberId: props.hostMember?.id,
  },
})

const submit = handleSubmit(async (values) => {
  if (!selectedFile.value) {
    toast.error('請上傳收據')
    return
  }

  isUploading.value = true

  try {
    const db = useFirestore()
    const storage = getStorage()

    // Create expense entry
    const expense: NewExpense = {
      description: 'Receipt Uploaded, processing',
      grandTotal: 0, // Default amount
      paidByMemberId: values.paidByMemberId,
      sharedWithMemberIds: values.sharedWithMemberIds,
      createdAt: serverTimestamp(),
      paidAt: serverTimestamp(),
      isProcessing: true,
      enabled: true,
    }

    const expenseDoc = await addDoc(collection(db, 'trips', props.trip.id, 'expenses'), expense)

    // Upload file to Firebase Storage
    const fileRef = storageRef(storage, `trips/${props.trip.id}/expenses/${expenseDoc.id}/${selectedFile.value.name}`)
    uploadBytes(fileRef, selectedFile.value)
    // const downloadURL = await getDownloadURL(snapshot.ref)

    // // Update the expense document with the download URL
    // await updateDoc(expenseDoc, {
    //   imageUrls: [downloadURL],
    // })

    emit('close')
    toast.success('收據上傳成功，正在解析收據中...')
  }
  catch (error) {
    console.error('Error uploading receipt:', error)
    toast.error('收據上傳失敗，請重新上傳')
  }
  finally {
    isUploading.value = false
  }
})
</script>

<template>
  <ui-drawer-header>
    <ui-drawer-title class="flex items-center gap-1 text-indigo-500 font-bold">
      <Icon name="lucide:zap" class="w-4 h-4" /> 快速建立支出
    </ui-drawer-title>
  </ui-drawer-header>
  <div class="space-y-4 px-4 py-4">
    <div class="grid w-full max-w-sm items-center gap-1.5">
      <ui-label for="picture">
        上傳收據（僅支援圖片格式）
      </ui-label>
      <ui-input
        id="picture"
        type="file"
        accept="image/*"
        @change="(e: Event) => selectedFile = (e.target as HTMLInputElement).files?.[0] ?? null"
      />
    </div>
    <ui-separator />
    <ui-form-field name="sharedWithMemberIds">
      <ui-form-item class="mb-4">
        <ui-form-label class="text-sm">
          選擇平分的成員
        </ui-form-label>
      </ui-form-item>
      <ui-form-field
        v-for="member in tripMembers"
        v-slot="{ value, handleChange }"
        :key="member.id"
        name="sharedWithMemberIds"
        type="checkbox"
        :value="member.id"
        :unchecked-value="false"
      >
        <ui-form-item class="flex flex-row items-center space-x-2 space-y-0">
          <ui-form-control>
            <ui-checkbox
              :model-value="value.includes(member.id)"
              @update:model-value="handleChange"
            />
          </ui-form-control>
          <ui-form-label class="font-normal flex items-center gap-1">
            <span class="text-sm">{{ member.avatarEmoji }}</span>
            <span class="text-sm">{{ member.name }}</span>
          </ui-form-label>
          <ui-form-message />
        </ui-form-item>
      </ui-form-field>
    </ui-form-field>
    <ui-separator />
    <ui-form-field v-slot="{ componentField }" type="radio" name="paidByMemberId">
      <ui-form-item class="space-y-3">
        <ui-form-label>選擇付款人</ui-form-label>
        <ui-form-control>
          <ui-radio-group
            class="flex flex-col space-y-1"
            v-bind="componentField"
          >
            <ui-form-item v-for="member in tripMembers" :key="member.id" class="flex items-center space-y-0 gap-x-3">
              <ui-form-control>
                <ui-radio-group-item :value="member.id" />
              </ui-form-control>
              <ui-form-label class="font-normal flex items-center gap-1">
                <span class="text-sm">{{ member.avatarEmoji }}</span>
                <span class="text-sm">{{ member.name }}</span>
              </ui-form-label>
            </ui-form-item>
          </ui-radio-group>
        </ui-form-control>
        <ui-form-message />
      </ui-form-item>
    </ui-form-field>
  </div>
  <ui-drawer-footer>
    <ui-button
      :disabled="isUploading"
      @click="submit"
    >
      <template v-if="isUploading">
        <Icon name="lucide:loader-circle" class="w-4 h-4 mr-2 animate-spin" /> Uploading...
      </template>
      <template v-else>
        Submit
      </template>
    </ui-button>
    <ui-drawer-close as-child>
      <ui-button variant="outline">
        Cancel
      </ui-button>
    </ui-drawer-close>
  </ui-drawer-footer>
</template>
