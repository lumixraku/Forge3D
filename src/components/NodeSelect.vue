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
  <div ref="root" class="forge:relative">
    <button type="button" class="forge:flex forge:h-7 forge:w-full forge:items-center forge:justify-between forge:rounded-[5px] forge:border forge:border-line-strong forge:bg-bg-input-hover forge:px-[7px] forge:text-left forge:font-mono forge:text-[9px] forge:text-text-primary forge:outline-0 forge:transition-[border-color,box-shadow] forge:duration-150 forge:hover:border-[var(--node-accent,#68d9d0)] forge:hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent,#68d9d0)_12%,transparent)] forge:aria-expanded:border-[var(--node-accent,#68d9d0)] forge:aria-expanded:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent,#68d9d0)_12%,transparent)]" :aria-expanded="open" aria-haspopup="listbox" @click.stop="open = !open" @pointerdown.stop>
      <span>{{ optionLabel(options.find(option => optionValue(option) === modelValue) ?? modelValue) }}</span>
      <span class="forge:inline-flex forge:text-xs forge:text-text-muted forge:transition-transform forge:duration-150" :class="{ 'forge:rotate-180': open }"><svg class="forge:block forge:size-[1em]" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
    </button>
    <div v-if="open" class="forge:absolute forge:left-0 forge:top-[calc(100%+5px)] forge:z-[1000] forge:grid forge:w-full forge:min-w-max forge:origin-top forge:overflow-hidden forge:rounded-[7px] forge:border forge:border-line-strong forge:bg-bg-input forge:p-1 forge:text-text-primary forge:shadow-popover forge:animate-[select-in_.12s_ease-out]" role="listbox" @pointerdown.stop>
      <button v-for="option in options" :key="optionValue(option)" type="button" class="forge:relative forge:grid forge:h-7 forge:w-full forge:grid-cols-[13px_1fr] forge:items-center forge:rounded forge:px-2 forge:text-left forge:font-mono forge:text-[9px] forge:font-medium forge:text-text-secondary forge:outline-0 forge:transition-colors forge:duration-150 forge:select-none forge:hover:bg-bg-input-hover forge:hover:text-text-primary forge:focus-visible:bg-bg-input-hover forge:focus-visible:text-text-primary" :class="{ 'forge:text-acid': optionValue(option) === modelValue }" role="option" :aria-selected="optionValue(option) === modelValue" @click="select(option)">
        <span class="forge:text-[10px]">{{ optionValue(option) === modelValue ? '✓' : '' }}</span>
        <span>{{ optionLabel(option) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
@keyframes select-in { from { opacity: 0; transform: translateY(-3px) scale(.98); } }
</style>
