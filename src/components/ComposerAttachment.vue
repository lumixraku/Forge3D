<script setup lang="ts">
import { computed } from 'vue'
import { NodeViewWrapper, nodeViewProps, type NodeViewProps } from '@tiptap/vue-3'

const props = defineProps<NodeViewProps>()
const isImage = computed(() => props.node.attrs.type.startsWith('image/'))
</script>

<template>
  <NodeViewWrapper as="span" class="composer-attachment" contenteditable="false">
    <img v-if="isImage && node.attrs.preview" :src="node.attrs.preview" alt="" />
    <span v-else class="composer-attachment-icon" aria-hidden="true">&#128206;</span>
    <span class="composer-attachment-name">{{ node.attrs.name }}</span>
  </NodeViewWrapper>
</template>
