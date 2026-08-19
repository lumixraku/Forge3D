<script setup lang="ts">
defineProps<{ preview: { src: string; alt: string } | null }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="preview" class="forge:group forge:fixed forge:inset-0 forge:z-[2000] forge:grid forge:place-items-center forge:bg-bg-overlay forge:p-12 forge:backdrop-blur-[10px] forge:animate-[backdrop-in_.15s_ease-out] forge:max-[760px]:p-5" role="dialog" aria-modal="true" :aria-label="preview.alt" @click.self="emit('close')">
      <button type="button" class="forge:fixed forge:right-6 forge:top-5 forge:z-[1] forge:grid forge:size-[38px] forge:place-items-center forge:rounded-full forge:border forge:border-white/20 forge:bg-[rgba(18,21,20,.86)] forge:p-0 forge:text-2xl forge:leading-none forge:text-white forge:transition-[border-color,color,transform] forge:hover:scale-108 forge:hover:border-acid forge:hover:text-acid forge:focus-visible:scale-108 forge:focus-visible:border-acid forge:focus-visible:text-acid forge:focus-visible:outline-none" aria-label="Close image preview" @click="emit('close')">×</button>
      <img class="forge:block forge:max-h-[88vh] forge:max-w-[min(1200px,92vw)] forge:rounded-[10px] forge:border forge:border-white/20 forge:bg-[#111] forge:object-contain forge:shadow-[0_24px_80px_rgba(0,0,0,.6)] forge:transition-transform forge:duration-150 forge:group-hover:scale-[1.01] forge:max-[760px]:max-h-[82vh] forge:max-[760px]:max-w-full" :src="preview.src" :alt="preview.alt" />
    </div>
  </Teleport>
</template>

<style scoped>
@keyframes backdrop-in { from { opacity: 0; } }
</style>
