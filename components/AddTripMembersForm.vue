<script setup lang="ts">
import type { TripMember } from '@/types'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import * as z from 'zod'
import {
  FormControl as UiFormControl,
  FormDescription as UiFormDescription,
  FormField as UiFormField,
  FormItem as UiFormItem,
  FormLabel as UiFormLabel,
  FormMessage as UiFormMessage,
} from '@/components/ui/form'
import { animalEmojis } from '@/constants'

const props = defineProps<{
  members: TripMember[]
  onMembersChange: (updatedMembers: TripMember[]) => void
}>()

const formSchema = z.object({
  name: z.string().min(1, 'Member name cannot be empty'),
  avatar: z.string().min(1, 'Please select an avatar for the member'),
})

type FormValues = z.infer<typeof formSchema>

const form = useForm<FormValues>({
  validationSchema: formSchema,
  initialValues: {
    name: '',
    avatar: animalEmojis[0],
  },
})

const onSubmit = form.handleSubmit((values: FormValues) => {
  const trimmedName = values.name.trim()

  const nameExists = props.members.some(
    member => member.name.toLowerCase() === trimmedName.toLowerCase(),
  )
  if (nameExists) {
    toast.error(`Member name "${trimmedName}" already exists.`)
    return
  }

  const avatarExists = props.members.some(
    member => member.avatarEmoji === values.avatar,
  )
  if (avatarExists) {
    toast.error(`Avatar ${values.avatar} has already been selected.`)
    return
  }

  const newMember: TripMember = {
    id: Date.now().toString(),
    name: trimmedName,
    avatarEmoji: values.avatar,
    createdAt: new Date() as any,
  }

  const updated = [...props.members, newMember]
  props.onMembersChange(updated)
  toast.success(`Added ${trimmedName} to the trip`)
  form.resetForm()

  const usedAvatars = updated.map(m => m.avatarEmoji)
  const nextAvailable = animalEmojis.find(e => !usedAvatars.includes(e))
  form.setFieldValue('avatar', nextAvailable || animalEmojis[0])
})

function handleRemoveMemberFromList(id: string) {
  const toRemove = props.members.find(m => m.id === id)
  const updated = props.members.filter(m => m.id !== id)
  props.onMembersChange(updated)
  if (toRemove)
    toast.success(`Removed ${toRemove.name} from the trip`)
}
</script>

<template>
  <div class="space-y-6 pt-6 border-t">
    <h3 class="text-xl font-semibold text-gray-700">
      Trip Members
    </h3>
    <div class="p-4 border border-gray-200 rounded-lg space-y-4 bg-gray-50">
      <form :validation-schema="formSchema" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-end" @submit.prevent="onSubmit">
        <div class="flex gap-2">
          <ui-form-field v-slot="{ componentField }" name="name" class="flex-1">
            <ui-form-item class="flex-1">
              <ui-form-control>
                <div class="relative flex-1">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Icon name="lucide:user-circle" :size="16" class="text-gray-400" />
                  </div>
                  <ui-input
                    v-bind="componentField"
                    type="text"
                    placeholder="Enter member name"
                    class="pl-10"
                  />
                </div>
              </ui-form-control>
              <ui-form-message />
            </ui-form-item>
          </ui-form-field>
          <ui-button
            type="submit"
            variant="default"
          >
            <Icon name="lucide:plus-circle" :size="18" class="mr-2" />
            Add Member
          </ui-button>
        </div>
        <ui-form-field v-slot="{ componentField }" name="avatar">
          <ui-form-item>
            <ui-form-label>Avatar Emoji</ui-form-label>
            <ui-form-control>
              <ui-select v-bind="componentField">
                <ui-select-trigger>
                  <ui-select-value :placeholder="form.values.avatar" />
                </ui-select-trigger>
                <ui-select-content>
                  <ui-select-item
                    v-for="emoji in animalEmojis"
                    :key="emoji"
                    :value="emoji"
                    class="text-lg"
                  >
                    {{ emoji }}
                  </ui-select-item>
                </ui-select-content>
              </ui-select>
            </ui-form-control>
            <ui-form-message />
          </ui-form-item>
        </ui-form-field>
      </form>
    </div>

    <div v-if="members.length > 0" class="space-y-3">
      <h4 class="text-sm font-medium text-gray-600">
        Members to be added: ({{ members.length }})
      </h4>
      <ul class="divide-y divide-gray-200 border rounded-md max-h-60 overflow-y-auto">
        <li
          v-for="member in members"
          :key="member.id"
          class="p-3 flex items-center justify-between hover:bg-gray-50"
        >
          <div class="flex items-center space-x-3">
            <span class="text-2xl">{{ member.avatarEmoji }}</span>
            <span class="text-gray-800 font-medium">{{ member.name }}</span>
          </div>
          <ui-button
            type="button"
            variant="ghost"
            size="icon"
            class="text-red-500 hover:text-red-700 hover:bg-red-100"
            title="Remove member"
            @click="handleRemoveMemberFromList(member.id)"
          >
            <XCircle :size="20" />
          </ui-button>
        </li>
      </ul>
    </div>
  </div>
</template>
