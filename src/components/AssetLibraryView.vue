<script setup lang="ts">
const props = defineProps<{ rails: any[]; total: number; loading?: boolean; canvasNodeIds?: string[] }>()
const emit = defineEmits<{ preview: [preview: { src: string; alt: string }]; 'open-model-editor': [nodeId: string] }>()

function scrollRail(event: MouseEvent, direction: number) {
  const track = (event.currentTarget as HTMLElement).closest('.asset-rail')?.querySelector('.asset-rail-track')
  track?.scrollBy({ left: direction * Math.min(track.clientWidth * 0.85, 520), behavior: 'smooth' })
}

function onCanvas(nodeId: string) {
  return !props.canvasNodeIds || props.canvasNodeIds.includes(nodeId)
}
</script>

<template>
  <div class="row-start-2 flex min-h-0 flex-col gap-[22px] overflow-y-auto bg-bg-primary px-5 pb-[26px] pt-[22px]">
    <div v-if="loading && !total" class="m-auto grid max-w-[340px] gap-1.5 text-center">
      <strong class="font-mono text-xs font-semibold tracking-[.04em] text-text-secondary">Loading assets…</strong>
      <span class="text-xs leading-normal text-text-muted">Reading this canvas's run history.</span>
    </div>
    <div v-else-if="!total" class="m-auto grid max-w-[340px] gap-1.5 text-center">
      <strong class="font-mono text-xs font-semibold tracking-[.04em] text-text-secondary">No assets yet</strong>
      <span class="text-xs leading-normal text-text-muted">References, generated 2D images and 3D models from every run of this canvas collect here.</span>
    </div>
    <template v-else>
      <section v-for="rail in rails" :key="rail.key" class="asset-rail flex flex-col gap-[11px]">
        <header class="flex items-center justify-between border-b border-line pb-[9px]">
          <div class="flex items-baseline gap-2"><span class="font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-text-secondary">{{ rail.title }}</span><b class="grid h-4 min-w-[18px] place-items-center rounded-lg bg-bg-input-hover px-[5px] font-mono text-[9px] font-semibold text-text-muted">{{ rail.items.length }}</b></div>
          <div v-if="rail.items.length" class="flex gap-[5px]">
            <button class="grid size-6 place-items-center rounded-md border border-line-subtle bg-bg-input p-0 text-sm leading-none text-text-muted transition-colors hover:border-line-strong hover:bg-bg-input-hover hover:text-acid" type="button" aria-label="Scroll left" @click="scrollRail($event, -1)">‹</button>
            <button class="grid size-6 place-items-center rounded-md border border-line-subtle bg-bg-input p-0 text-sm leading-none text-text-muted transition-colors hover:border-line-strong hover:bg-bg-input-hover hover:text-acid" type="button" aria-label="Scroll right" @click="scrollRail($event, 1)">›</button>
          </div>
        </header>
        <div v-if="rail.items.length" class="asset-rail-track flex snap-x snap-proximity gap-3 overflow-x-auto pb-1.5 [scrollbar-width:thin]">
          <article v-for="item in rail.items" :key="item.id" class="group relative flex w-[168px] flex-none snap-start flex-col gap-2 rounded-[11px] border border-line bg-bg-card p-2 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg">
            <button type="button" class="block aspect-square w-full cursor-zoom-in overflow-hidden rounded-lg border-0 bg-bg-input-hover p-0" @click="emit('preview', { src: item.src, alt: item.label })"><img class="block size-full object-cover" :src="item.src" :alt="item.label" loading="lazy" /></button>
            <div class="flex items-center justify-between gap-1.5 px-0.5"><strong class="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] font-medium text-text-primary" :title="item.label">{{ item.label }}</strong><span class="flex-none rounded-[5px] bg-bg-input-hover px-1.5 py-0.5 font-mono text-[8px] font-semibold tracking-[.06em] text-text-muted">{{ rail.badge }}</span></div>
            <div class="flex items-baseline justify-between gap-1.5 px-0.5 font-mono text-[9px] font-medium text-text-muted"><span class="uppercase tracking-[.06em] text-text-secondary" :title="item.runId">{{ item.runLabel }}</span><time class="overflow-hidden text-ellipsis whitespace-nowrap" :datetime="item.createdAt">{{ new Date(item.createdAt).toLocaleString() }}</time></div>
            <button v-if="rail.key === 'models' && onCanvas(item.nodeId)" type="button" class="absolute right-3.5 top-3.5 grid size-[26px] place-items-center rounded-[7px] border-0 bg-[color-mix(in_srgb,var(--bg-card)_82%,transparent)] p-0 text-[13px] leading-none text-text-secondary opacity-0 backdrop-blur transition-[opacity,background,color] group-hover:opacity-100 hover:bg-acid hover:text-text-inverse" title="Open in Model Editor" @click="emit('open-model-editor', item.nodeId)">↗</button>
          </article>
        </div>
        <p v-else class="px-0.5 py-5 font-mono text-[10px] font-medium tracking-[.04em] text-text-muted">No {{ rail.title.toLowerCase() }} yet</p>
      </section>
    </template>
  </div>
</template>
