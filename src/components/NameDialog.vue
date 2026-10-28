<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{ open: boolean; title: string; initial: string }>()
const emit = defineEmits<{ confirm: [name: string]; dismiss: [] }>()

const name = ref('')
const input = ref<HTMLInputElement | null>(null)

watch(() => props.open, (open) => {
  if (!open) return
  name.value = props.initial
  nextTick(() => {
    input.value?.focus()
    input.value?.select()
  })
}, { immediate: true })

function confirm() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  emit('confirm', trimmed)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="forge:fixed forge:inset-0 forge:z-[1500] forge:grid forge:place-items-center forge:bg-bg-overlay forge:p-6 forge:backdrop-blur-[6px]" @click.self="emit('dismiss')">
      <form class="forge:grid forge:w-[min(400px,100%)] forge:gap-4 forge:rounded-[16px] forge:border forge:border-line-strong forge:bg-bg-card forge:p-6 forge:shadow-popover" role="dialog" aria-modal="true" aria-labelledby="name-dialog-title" @submit.prevent="confirm">
        <header class="forge:flex forge:items-start forge:justify-between forge:gap-3">
          <h2 id="name-dialog-title" class="forge:m-0 forge:text-[17px] forge:text-text-primary">{{ title }}</h2>
          <button type="button" class="forge3d-bare forge:grid forge:size-8 forge:flex-none forge:place-items-center forge:rounded-full forge:border-0 forge:bg-transparent forge:text-xl forge:leading-none forge:text-text-muted forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid" aria-label="Cancel" @click="emit('dismiss')">×</button>
        </header>
        <label class="forge:grid forge:gap-1.5 forge:text-[13px] forge:text-text-primary">
          <span>Name</span>
          <input ref="input" v-model="name" class="forge:h-10 forge:rounded-[10px] forge:border forge:border-line-strong forge:bg-bg-input forge:px-3 forge:text-[13px] forge:outline-none forge:focus:border-acid" type="text" maxlength="120" autocomplete="off" />
        </label>
        <footer class="forge:flex forge:justify-end forge:gap-2">
          <button type="button" class="forge:h-9 forge:border forge:border-line-strong forge:bg-bg-input forge:px-4 forge:text-[13px] forge:text-text-secondary" @click="emit('dismiss')">Cancel</button>
          <button type="submit" class="forge:h-9 forge:border-0 forge:bg-acid forge:px-4 forge:text-[13px] forge:text-text-inverse" :disabled="!name.trim()">Create</button>
        </footer>
      </form>
    </div>
  </Teleport>
</template>
