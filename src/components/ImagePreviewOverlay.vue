<script setup lang="ts">
defineProps<{ preview: { src: string; alt: string } | null }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="preview" class="group fixed inset-0 z-[2000] grid place-items-center bg-bg-overlay p-12 backdrop-blur-[10px] animate-[backdrop-in_.15s_ease-out] max-[760px]:p-5" role="dialog" aria-modal="true" :aria-label="preview.alt" @click.self="emit('close')">
      <button type="button" class="fixed right-6 top-5 z-[1] grid size-[38px] place-items-center rounded-full border border-white/20 bg-[rgba(18,21,20,.86)] p-0 text-2xl leading-none text-white transition-[border-color,color,transform] hover:scale-108 hover:border-acid hover:text-acid focus-visible:scale-108 focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" aria-label="Close image preview" @click="emit('close')">×</button>
      <img class="block max-h-[88vh] max-w-[min(1200px,92vw)] rounded-[10px] border border-white/20 bg-[#111] object-contain shadow-[0_24px_80px_rgba(0,0,0,.6)] transition-transform duration-150 group-hover:scale-[1.01] max-[760px]:max-h-[82vh] max-[760px]:max-w-full" :src="preview.src" :alt="preview.alt" />
    </div>
  </Teleport>
</template>

<style scoped>
@keyframes backdrop-in { from { opacity: 0; } }
</style>
