<script setup lang="ts">
defineProps<{ catalog: any[]; categories: string[] }>()
const emit = defineEmits<{ select: [type: string]; dragstart: [payload: { event: DragEvent; type: string }] }>()
</script>

<template>
  <template v-for="category in categories" :key="category">
    <strong v-if="catalog.some((item) => item.category === category)">{{ category }}</strong>
    <button v-for="item in catalog.filter((item) => item.category === category)" :key="item.type" type="button" draggable="true" @dragstart="emit('dragstart', { event: $event, type: item.type })" @click="emit('select', item.type)">
      <span>{{ item.label }}</span><small>{{ item.description }}</small>
    </button>
  </template>
</template>
