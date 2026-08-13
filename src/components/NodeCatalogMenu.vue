<script setup lang="ts">
defineProps<{ catalog: any[]; categories: string[] }>()
const emit = defineEmits<{ select: [type: string]; dragstart: [payload: { event: DragEvent; type: string }] }>()
</script>

<template>
  <template v-for="category in categories" :key="category">
    <strong v-if="catalog.some((item) => item.category === category)" class="px-[9px] pb-1 pt-2 font-mono text-[8px] font-semibold uppercase tracking-[.12em] text-text-muted">{{ category }}</strong>
    <button v-for="item in catalog.filter((item) => item.category === category)" :key="item.type" type="button" class="grid min-h-[45px] w-full rounded-md border border-transparent bg-transparent px-[9px] py-[7px] text-left transition-[border-color,background] duration-150 hover:border-line-strong hover:bg-bg-input-hover" draggable="true" @dragstart="emit('dragstart', { event: $event, type: item.type })" @click="emit('select', item.type)">
      <span class="font-sans text-[10px] font-medium tracking-normal text-text-primary">{{ item.label }}</span><small class="mt-[3px] block font-mono text-[8px] font-normal text-text-muted">{{ item.description }}</small>
    </button>
  </template>
</template>
