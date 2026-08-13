<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

type SelectValue = string | number
type SelectOption = SelectValue | { value: SelectValue; label: string }

const props = withDefaults(defineProps<{ modelValue: SelectValue; options: SelectOption[]; dismissVersion?: number }>(), { dismissVersion: 0 })

const emit = defineEmits<{ 'update:modelValue': [value: SelectValue] }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

watch(() => props.dismissVersion, () => { open.value = false })

function closeOnOutsidePointerDown(event: PointerEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) open.value = false
}

watch(open, (isOpen) => {
  window[isOpen ? 'addEventListener' : 'removeEventListener']('pointerdown', closeOnOutsidePointerDown, true)
})

onBeforeUnmount(() => window.removeEventListener('pointerdown', closeOnOutsidePointerDown, true))

function optionValue(option: SelectOption): SelectValue {
  return typeof option === 'object' ? option.value : option
}

function optionLabel(option: SelectOption): string {
  return typeof option === 'object' ? option.label : option
}

function select(option: SelectOption) {
  emit('update:modelValue', optionValue(option))
  open.value = false
}
</script>

<template>
  <div ref="root" class="relative">
    <button type="button" class="flex h-7 w-full items-center justify-between rounded-[5px] border border-line-strong bg-bg-input-hover px-[7px] text-left font-mono text-[9px] text-text-primary outline-0 transition-[border-color,box-shadow] duration-150 hover:border-[var(--node-accent,#68d9d0)] hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent,#68d9d0)_12%,transparent)] aria-expanded:border-[var(--node-accent,#68d9d0)] aria-expanded:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent,#68d9d0)_12%,transparent)]" :aria-expanded="open" aria-haspopup="listbox" @click.stop="open = !open" @pointerdown.stop>
      <span>{{ optionLabel(options.find(option => optionValue(option) === modelValue) ?? modelValue) }}</span>
      <span class="inline-flex text-xs text-text-muted transition-transform duration-150" :class="{ 'rotate-180': open }"><svg class="block size-[1em]" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
    </button>
    <div v-if="open" class="absolute left-0 top-[calc(100%+5px)] z-[1000] grid w-full min-w-max origin-top overflow-hidden rounded-[7px] border border-line-strong bg-bg-input p-1 text-text-primary shadow-popover animate-[select-in_.12s_ease-out]" role="listbox" @pointerdown.stop>
      <button v-for="option in options" :key="optionValue(option)" type="button" class="relative grid h-7 w-full grid-cols-[13px_1fr] items-center rounded px-2 text-left font-mono text-[9px] font-medium text-text-secondary outline-0 transition-colors duration-150 select-none hover:bg-bg-input-hover hover:text-text-primary focus-visible:bg-bg-input-hover focus-visible:text-text-primary" :class="{ 'text-acid': optionValue(option) === modelValue }" role="option" :aria-selected="optionValue(option) === modelValue" @click="select(option)">
        <span class="text-[10px]">{{ optionValue(option) === modelValue ? '✓' : '' }}</span>
        <span>{{ optionLabel(option) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
@keyframes select-in { from { opacity: 0; transform: translateY(-3px) scale(.98); } }
</style>
