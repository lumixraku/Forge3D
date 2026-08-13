<script setup lang="ts">
import { computed } from 'vue'
import { NodeViewWrapper, nodeViewProps, type NodeViewProps } from '@tiptap/vue-3'

const props = defineProps<NodeViewProps>()
const isImage = computed(() => props.node.attrs.type.startsWith('image/'))
</script>

<template>
  <NodeViewWrapper as="span" class="composer-attachment group relative mx-[3px] inline-flex h-[25px] min-w-0 max-w-[min(120px,100%)] select-none items-center rounded-lg border border-line-strong bg-bg-input-hover py-0 pl-[3px] pr-2 align-middle leading-none text-text-primary [&.ProseMirror-selectednode]:border-acid [&.ProseMirror-selectednode]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--acid)_20%,transparent)]" contenteditable="false">
    <img v-if="isImage && node.attrs.preview" class="mr-[5px] grid size-[19px] place-items-center rounded-[5px] bg-bg-active object-cover text-[11px]" :src="node.attrs.preview" alt="" />
    <span v-else class="mr-[5px] grid size-[19px] place-items-center rounded-[5px] bg-bg-active text-[11px]" aria-hidden="true">&#128206;</span>
    <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ node.attrs.name }}</span>
    <span v-if="isImage && node.attrs.preview" class="composer-attachment-preview absolute bottom-[calc(100%+10px)] left-1/2 z-30 block w-[220px] origin-bottom -translate-x-1/2 translate-y-[5px] scale-[.98] rounded-[10px] border border-line-strong bg-bg-panel opacity-0 shadow-[0_12px_28px_color-mix(in_srgb,#000_24%,transparent)] transition-[opacity,transform] duration-120 pointer-events-none group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100 group-focus-within:opacity-100" role="tooltip">
      <img class="block h-[180px] w-full rounded-[9px] bg-bg-primary object-cover" :src="node.attrs.preview" :alt="`Preview of ${node.attrs.name}`" />
    </span>
  </NodeViewWrapper>
</template>

<style scoped>
.composer-attachment-preview::after { position: absolute; top: 100%; left: 50%; width: 10px; height: 10px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); background: var(--bg-panel); content: ''; transform: translate(-50%, -5px) rotate(45deg); }
</style>
