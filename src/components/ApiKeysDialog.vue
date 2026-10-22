<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{ open: boolean; deepseekKey: string; meshyKey: string }>()
const emit = defineEmits<{ save: [keys: { deepseek: string; meshy: string }]; dismiss: [] }>()

const deepseek = ref('')
const meshy = ref('')
const firstInput = ref<HTMLInputElement | null>(null)

watch(() => props.open, (open) => {
  if (!open) return
  deepseek.value = props.deepseekKey
  meshy.value = props.meshyKey
  nextTick(() => firstInput.value?.focus())
}, { immediate: true })

function save() {
  emit('save', { deepseek: deepseek.value, meshy: meshy.value })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="forge:fixed forge:inset-0 forge:z-[1500] forge:grid forge:place-items-center forge:bg-bg-overlay forge:p-6 forge:backdrop-blur-[6px]" @click.self="emit('dismiss')" @keydown.esc.stop="emit('dismiss')">
      <form class="forge:grid forge:w-[min(440px,100%)] forge:gap-4 forge:rounded-[16px] forge:border forge:border-line-strong forge:bg-bg-card forge:p-6 forge:shadow-popover" role="dialog" aria-modal="true" aria-labelledby="api-keys-title" aria-describedby="api-keys-desc" @submit.prevent="save">
        <header class="forge:flex forge:items-start forge:justify-between forge:gap-3">
          <div>
            <h2 id="api-keys-title" class="forge:m-0 forge:text-[17px] forge:text-text-primary">Use your own API keys</h2>
            <p id="api-keys-desc" class="forge:mb-0 forge:mt-1.5 forge:text-[13px] forge:leading-[1.5] forge:text-text-secondary">The copilot runs on DeepSeek and 3D generation on Meshy. Add your keys to use your own quota, or close this to try the demo keys.</p>
          </div>
          <button type="button" class="forge3d-bare forge:grid forge:size-8 forge:flex-none forge:place-items-center forge:rounded-full forge:border-0 forge:bg-transparent forge:text-xl forge:leading-none forge:text-text-muted forge:hover:bg-bg-input-hover forge:hover:text-text-primary" aria-label="Close and use the demo keys" @click="emit('dismiss')">×</button>
        </header>

        <label class="forge:grid forge:gap-1.5 forge:text-[13px] forge:text-text-primary">
          <span class="forge:flex forge:items-baseline forge:justify-between">DeepSeek API key <a class="forge:text-[12px] forge:text-acid" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">Get a key</a></span>
          <input ref="firstInput" v-model="deepseek" class="forge:h-10 forge:rounded-[10px] forge:border forge:border-line-strong forge:bg-bg-input forge:px-3 forge:font-mono forge:text-[13px] forge:outline-none forge:focus:border-acid" type="password" autocomplete="off" spellcheck="false" placeholder="sk-..." maxlength="256" />
        </label>

        <label class="forge:grid forge:gap-1.5 forge:text-[13px] forge:text-text-primary">
          <span class="forge:flex forge:items-baseline forge:justify-between">Meshy API key <a class="forge:text-[12px] forge:text-acid" href="https://www.meshy.ai/settings/api" target="_blank" rel="noopener noreferrer">Get a key</a></span>
          <input v-model="meshy" class="forge:h-10 forge:rounded-[10px] forge:border forge:border-line-strong forge:bg-bg-input forge:px-3 forge:font-mono forge:text-[13px] forge:outline-none forge:focus:border-acid" type="password" autocomplete="off" spellcheck="false" placeholder="msy_..." maxlength="256" />
        </label>

        <p class="forge:m-0 forge:text-[12px] forge:leading-[1.5] forge:text-text-muted">Keys stay in this browser. Each request passes them through this site's server to DeepSeek or Meshy; they are not saved on the server. Leave a field empty to use the demo key for it.</p>

        <footer class="forge:flex forge:justify-end forge:gap-2">
          <button type="button" class="forge:h-9 forge:border forge:border-line-strong forge:bg-bg-input forge:px-4 forge:text-[13px] forge:text-text-secondary" @click="emit('dismiss')">Use demo keys</button>
          <button type="submit" class="forge:h-9 forge:border-0 forge:bg-acid forge:px-4 forge:text-[13px] forge:text-text-inverse">Save keys</button>
        </footer>
      </form>
    </div>
  </Teleport>
</template>
