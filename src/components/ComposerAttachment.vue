<script setup lang="ts">
import { computed } from 'vue'
import { NodeViewWrapper, nodeViewProps, type NodeViewProps } from '@tiptap/vue-3'

const props = defineProps<NodeViewProps>()
const isImage = computed(() => props.node.attrs.type.startsWith('image/'))
</script>

<template>
  <NodeViewWrapper as="span" class="forge3d-composer-attachment forge:group forge:relative forge:mx-[3px] forge:inline-flex forge:h-[25px] forge:min-w-0 forge:max-w-[min(120px,100%)] forge:select-none forge:items-center forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input-hover forge:py-0 forge:pl-[3px] forge:pr-2 forge:align-middle forge:leading-none forge:text-text-primary forge:[&.ProseMirror-selectednode]:border-acid forge:[&.ProseMirror-selectednode]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--acid)_20%,transparent)]" contenteditable="false">
    <img v-if="isImage && node.attrs.preview" class="forge:mr-[5px] forge:grid forge:size-[19px] forge:place-items-center forge:rounded-[5px] forge:bg-bg-active forge:object-cover forge:text-[11px]" :src="node.attrs.preview" alt="" />
    <span v-else class="forge:mr-[5px] forge:grid forge:size-[19px] forge:place-items-center forge:rounded-[5px] forge:bg-bg-active forge:text-[11px]" aria-hidden="true">&#128206;</span>
    <span class="forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap">{{ node.attrs.name }}</span>
    <span v-if="isImage && node.attrs.preview" class="forge3d-composer-attachment-preview forge:absolute forge:bottom-[calc(100%+10px)] forge:left-1/2 forge:z-30 forge:block forge:w-[220px] forge:origin-bottom forge:-translate-x-1/2 forge:translate-y-[5px] forge:scale-[.98] forge:rounded-[10px] forge:border forge:border-line-strong forge:bg-bg-panel forge:opacity-0 forge:shadow-[0_12px_28px_color-mix(in_srgb,#000_24%,transparent)] forge:transition-[opacity,transform] forge:duration-120 forge:pointer-events-none forge:group-hover:translate-y-0 forge:group-hover:scale-100 forge:group-hover:opacity-100 forge:group-focus-within:translate-y-0 forge:group-focus-within:scale-100 forge:group-focus-within:opacity-100" role="tooltip">
      <img class="forge:block forge:h-[180px] forge:w-full forge:rounded-[9px] forge:bg-bg-primary forge:object-cover" :src="node.attrs.preview" :alt="`Preview of ${node.attrs.name}`" />
    </span>
  </NodeViewWrapper>
</template>

<style scoped>
.forge3d-composer-attachment-preview::after { position: absolute; top: 100%; left: 50%; width: 10px; height: 10px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); background: var(--bg-panel); content: ''; transform: translate(-50%, -5px) rotate(45deg); }
</style>
