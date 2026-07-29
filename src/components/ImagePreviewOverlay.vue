<script setup lang="ts">
defineProps<{ preview: { src: string; alt: string } | null }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="preview" class="image-preview-backdrop" role="dialog" aria-modal="true" :aria-label="preview.alt" @click.self="emit('close')">
      <button type="button" class="image-preview-close" aria-label="Close image preview" @click="emit('close')">×</button>
      <img class="image-preview-image" :src="preview.src" :alt="preview.alt" />
    </div>
  </Teleport>
</template>
