<script setup lang="ts" generic="T extends string | string[] | undefined">
interface PickerMember {
  id: string
  name: string
  avatarEmoji: string
}

const props = withDefaults(defineProps<{
  members: PickerMember[]
  // Checkboxes bound to string[] instead of a single-choice radio bound to string
  multiple?: boolean
  // Full-width 全選 row above the members (multiple mode only)
  selectAll?: boolean
  label?: string
  // Error state (red rows, aria-invalid); pair it with a visible message
  invalid?: boolean
}>(), {
  multiple: false,
  selectAll: false,
  invalid: false,
})

const model = defineModel<T>()

const selectedIds = computed<string[]>(() => {
  const value = model.value
  if (Array.isArray(value))
    return value
  return value ? [value] : []
})

const selectedCount = computed(() =>
  props.members.filter(m => selectedIds.value.includes(m.id)).length,
)

const allSelected = computed(() =>
  props.members.length > 0 && selectedCount.value === props.members.length,
)

function select(id: string) {
  model.value = id as T
}

function toggle(id: string, checked: boolean) {
  const others = selectedIds.value.filter(x => x !== id)
  model.value = (checked ? [...others, id] : others) as T
}

function toggleAll() {
  model.value = (allSelected.value ? [] : props.members.map(m => m.id)) as T
}

// Whole row is the tap target; it takes the selected tint from its control's state
const rowClass = computed(() => [
  'flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-md border px-3 transition-colors hover:bg-muted/50 has-[[data-state=checked]]:bg-primary/5',
  props.invalid ? 'border-destructive' : 'has-[[data-state=checked]]:border-primary',
])
</script>

<template>
  <ui-radio-group
    v-if="!multiple"
    :model-value="typeof model === 'string' ? model : undefined"
    :aria-label="label"
    :aria-invalid="invalid || undefined"
    class="grid grid-cols-2 gap-2"
    @update:model-value="(id) => select(String(id))"
  >
    <label v-for="member in members" :key="member.id" :class="rowClass">
      <ui-radio-group-item :value="member.id" :aria-invalid="invalid || undefined" />
      <member-avatar :emoji="member.avatarEmoji" size="sm" />
      <span class="truncate text-sm">{{ member.name }}</span>
    </label>
  </ui-radio-group>

  <div
    v-else
    role="group"
    :aria-label="label"
    :aria-invalid="invalid || undefined"
    class="grid grid-cols-2 gap-2"
  >
    <label v-if="selectAll" class="col-span-2" :class="rowClass">
      <ui-checkbox :model-value="allSelected" :aria-invalid="invalid || undefined" @update:model-value="toggleAll" />
      <span class="text-sm font-medium">全選</span>
      <span class="ms-auto font-mono text-xs text-muted-foreground">{{ selectedCount }}/{{ members.length }}</span>
    </label>
    <label v-for="member in members" :key="member.id" :class="rowClass">
      <ui-checkbox
        :model-value="selectedIds.includes(member.id)"
        :aria-invalid="invalid || undefined"
        @update:model-value="(checked) => toggle(member.id, checked === true)"
      />
      <member-avatar :emoji="member.avatarEmoji" size="sm" />
      <span class="truncate text-sm">{{ member.name }}</span>
    </label>
  </div>
</template>
