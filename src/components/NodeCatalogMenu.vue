<script setup lang="ts">
defineProps<{ catalog: any[]; categories: string[] }>()
const emit = defineEmits<{ select: [type: string]; dragstart: [payload: { event: DragEvent; type: string }] }>()
</script>

<template>
  <template v-for="category in categories" :key="category">
    <strong v-if="catalog.some((item) => item.category === category)" class="forge:px-2.5 forge:pb-0.5 forge:pt-2 forge:text-[12px] forge:font-semibold forge:text-text-muted">{{ category }}</strong>
    <button v-for="item in catalog.filter((item) => item.category === category)" :key="item.type" type="button" class="forge3d-flat forge:grid forge:w-full forge:rounded-lg forge:border-0 forge:bg-transparent forge:px-2.5 forge:py-2 forge:text-left forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--acid)_6%,var(--bg-input))]" draggable="true" @dragstart="emit('dragstart', { event: $event, type: item.type })" @click="emit('select', item.type)">
      <span class="forge:text-xs forge:text-text-primary">{{ item.label }}</span><small class="forge:mt-[5px] forge:block forge:font-mono forge:text-[11px] forge:font-normal forge:text-text-muted">{{ item.description }}</small>
    </button>
  </template>
</template>
