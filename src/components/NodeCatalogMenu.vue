<script setup lang="ts">
defineProps<{ catalog: any[]; categories: string[] }>()
const emit = defineEmits<{ select: [type: string]; dragstart: [payload: { event: DragEvent; type: string }] }>()
</script>

<template>
  <template v-for="category in categories" :key="category">
    <strong v-if="catalog.some((item) => item.category === category)" class="forge:px-[9px] forge:pb-1 forge:pt-2 forge:font-mono forge:text-[8px] forge:font-semibold forge:uppercase forge:tracking-[.12em] forge:text-text-muted">{{ category }}</strong>
    <button v-for="item in catalog.filter((item) => item.category === category)" :key="item.type" type="button" class="forge:grid forge:min-h-[45px] forge:w-full forge:rounded-md forge:border forge:border-transparent forge:bg-transparent forge:px-[9px] forge:py-[7px] forge:text-left forge:transition-[border-color,background] forge:duration-150 forge:hover:border-line-strong forge:hover:bg-bg-input-hover" draggable="true" @dragstart="emit('dragstart', { event: $event, type: item.type })" @click="emit('select', item.type)">
      <span class="forge:font-sans forge:text-[10px] forge:font-medium forge:tracking-normal forge:text-text-primary">{{ item.label }}</span><small class="forge:mt-[3px] forge:block forge:font-mono forge:text-[8px] forge:font-normal forge:text-text-muted">{{ item.description }}</small>
    </button>
  </template>
</template>
