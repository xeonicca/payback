<script lang="ts" setup>
import type { DateValue } from '@internationalized/date'
import type { HTMLAttributes, Ref } from 'vue'
import { getLocalTimeZone, today } from '@internationalized/date'
import { reactiveOmit, useVModel } from '@vueuse/core'
import { CalendarRoot, type CalendarRootEmits, type CalendarRootProps, useForwardPropsEmits } from 'reka-ui'
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import { CalendarCell, CalendarCellTrigger, CalendarGrid, CalendarGridBody, CalendarGridHead, CalendarGridRow, CalendarHeadCell, CalendarHeader, CalendarNextButton, CalendarPrevButton } from '.'

const props = defineProps<CalendarRootProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<CalendarRootEmits>()

const delegatedProps = reactiveOmit(props, 'class', 'placeholder')

const forwarded = useForwardPropsEmits(delegatedProps, emits)

// Owned here so the month/year selects can jump the visible month directly.
const placeholder = useVModel(props, 'placeholder', emits, {
  passive: true,
  defaultValue: ((props.modelValue as DateValue | undefined) ?? props.defaultValue ?? today(getLocalTimeZone())) as DateValue,
}) as unknown as Ref<DateValue>

// Follow the device language, falling back to zh-TW to match the app's UI.
const locale = computed(() => props.locale || (typeof navigator !== 'undefined' && navigator.language) || 'zh-TW')

const monthOptions = computed(() => {
  const formatter = new Intl.DateTimeFormat(locale.value, { month: 'short' })
  return Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: formatter.format(new Date(2000, i, 1)),
  }))
})

// A misread receipt year can be far off, so always include the shown year.
const yearOptions = computed(() => {
  const currentYear = today(getLocalTimeZone()).year
  const shownYear = placeholder.value.year
  const start = Math.min(currentYear - 10, shownYear)
  const end = Math.max(currentYear + 1, shownYear)
  return Array.from({ length: end - start + 1 }, (_, i) => end - i)
})

function setMonth(event: Event) {
  placeholder.value = placeholder.value.set({ month: Number((event.target as HTMLSelectElement).value) })
}

function setYear(event: Event) {
  placeholder.value = placeholder.value.set({ year: Number((event.target as HTMLSelectElement).value) })
}

const selectClass = 'h-7 rounded-md border border-input bg-transparent px-1.5 text-sm font-medium outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'
</script>

<template>
  <CalendarRoot
    v-slot="{ grid, weekDays }"
    v-model:placeholder="placeholder"
    data-slot="calendar"
    :class="cn('p-3', props.class)"
    v-bind="forwarded"
    :locale="locale"
  >
    <CalendarHeader>
      <div class="flex items-center gap-1">
        <select
          :value="placeholder.month"
          :class="selectClass"
          aria-label="月份"
          @change="setMonth"
        >
          <option v-for="month in monthOptions" :key="month.value" :value="month.value">
            {{ month.label }}
          </option>
        </select>
        <select
          :value="placeholder.year"
          :class="selectClass"
          aria-label="年份"
          @change="setYear"
        >
          <option v-for="year in yearOptions" :key="year" :value="year">
            {{ year }}
          </option>
        </select>
      </div>

      <div class="flex items-center gap-1">
        <CalendarPrevButton />
        <CalendarNextButton />
      </div>
    </CalendarHeader>

    <div class="flex flex-col gap-y-4 mt-4 sm:flex-row sm:gap-x-4 sm:gap-y-0">
      <CalendarGrid v-for="month in grid" :key="month.value.toString()">
        <CalendarGridHead>
          <CalendarGridRow>
            <CalendarHeadCell
              v-for="day in weekDays" :key="day"
            >
              {{ day }}
            </CalendarHeadCell>
          </CalendarGridRow>
        </CalendarGridHead>
        <CalendarGridBody>
          <CalendarGridRow v-for="(weekDates, index) in month.rows" :key="`weekDate-${index}`" class="mt-2 w-full">
            <CalendarCell
              v-for="weekDate in weekDates"
              :key="weekDate.toString()"
              :date="weekDate"
            >
              <CalendarCellTrigger
                :day="weekDate"
                :month="month.value"
              />
            </CalendarCell>
          </CalendarGridRow>
        </CalendarGridBody>
      </CalendarGrid>
    </div>
  </CalendarRoot>
</template>
