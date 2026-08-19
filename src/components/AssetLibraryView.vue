<script setup lang="ts">
const props = defineProps<{ rails: any[]; total: number; loading?: boolean; canvasNodeIds?: string[] }>()
const emit = defineEmits<{ preview: [preview: { src: string; alt: string }]; 'open-model-editor': [nodeId: string] }>()

function scrollRail(event: MouseEvent, direction: number) {
  const track = (event.currentTarget as HTMLElement).closest('.forge3d-asset-rail')?.querySelector('.forge3d-asset-rail-track')
  track?.scrollBy({ left: direction * Math.min(track.clientWidth * 0.85, 520), behavior: 'smooth' })
}

function onCanvas(nodeId: string) {
  return !props.canvasNodeIds || props.canvasNodeIds.includes(nodeId)
}
</script>

<template>
  <div class="forge:row-start-2 forge:flex forge:min-h-0 forge:flex-col forge:gap-[22px] forge:overflow-y-auto forge:bg-bg-primary forge:px-5 forge:pb-[26px] forge:pt-[22px]">
    <div v-if="loading && !total" class="forge:m-auto forge:grid forge:max-w-[340px] forge:gap-1.5 forge:text-center">
      <strong class="forge:font-mono forge:text-xs forge:font-semibold forge:tracking-[.04em] forge:text-text-secondary">Loading assets…</strong>
      <span class="forge:text-xs forge:leading-normal forge:text-text-muted">Reading this canvas's run history.</span>
    </div>
    <div v-else-if="!total" class="forge:m-auto forge:grid forge:max-w-[340px] forge:gap-1.5 forge:text-center">
      <strong class="forge:font-mono forge:text-xs forge:font-semibold forge:tracking-[.04em] forge:text-text-secondary">No assets yet</strong>
      <span class="forge:text-xs forge:leading-normal forge:text-text-muted">References, generated 2D images and 3D models from every run of this canvas collect here.</span>
    </div>
    <template v-else>
      <section v-for="rail in rails" :key="rail.key" class="forge3d-asset-rail forge:flex forge:flex-col forge:gap-[11px]">
        <header class="forge:flex forge:items-center forge:justify-between forge:border-b forge:border-line forge:pb-[9px]">
          <div class="forge:flex forge:items-baseline forge:gap-2"><span class="forge:font-mono forge:text-[10px] forge:font-semibold forge:uppercase forge:tracking-[.14em] forge:text-text-secondary">{{ rail.title }}</span><b class="forge:grid forge:h-4 forge:min-w-[18px] forge:place-items-center forge:rounded-lg forge:bg-bg-input-hover forge:px-[5px] forge:font-mono forge:text-[9px] forge:font-semibold forge:text-text-muted">{{ rail.items.length }}</b></div>
          <div v-if="rail.items.length" class="forge:flex forge:gap-[5px]">
            <button class="forge:grid forge:size-6 forge:place-items-center forge:rounded-md forge:border forge:border-line-subtle forge:bg-bg-input forge:p-0 forge:text-sm forge:leading-none forge:text-text-muted forge:transition-colors forge:hover:border-line-strong forge:hover:bg-bg-input-hover forge:hover:text-acid" type="button" aria-label="Scroll left" @click="scrollRail($event, -1)">‹</button>
            <button class="forge:grid forge:size-6 forge:place-items-center forge:rounded-md forge:border forge:border-line-subtle forge:bg-bg-input forge:p-0 forge:text-sm forge:leading-none forge:text-text-muted forge:transition-colors forge:hover:border-line-strong forge:hover:bg-bg-input-hover forge:hover:text-acid" type="button" aria-label="Scroll right" @click="scrollRail($event, 1)">›</button>
          </div>
        </header>
        <div v-if="rail.items.length" class="forge3d-asset-rail-track forge:flex forge:snap-x forge:snap-proximity forge:gap-3 forge:overflow-x-auto forge:pb-1.5 forge:[scrollbar-width:thin]">
          <article v-for="item in rail.items" :key="item.id" class="forge:group forge:relative forge:flex forge:w-[168px] forge:flex-none forge:snap-start forge:flex-col forge:gap-2 forge:rounded-[11px] forge:border forge:border-line forge:bg-bg-card forge:p-2 forge:transition-[border-color,box-shadow,transform] forge:duration-150 forge:hover:-translate-y-0.5 forge:hover:border-line-strong forge:hover:shadow-lg">
            <button type="button" class="forge:block forge:aspect-square forge:w-full forge:cursor-zoom-in forge:overflow-hidden forge:rounded-lg forge:border-0 forge:bg-bg-input-hover forge:p-0" @click="emit('preview', { src: item.src, alt: item.label })"><img class="forge:block forge:size-full forge:object-cover" :src="item.src" :alt="item.label" loading="lazy" /></button>
            <div class="forge:flex forge:items-center forge:justify-between forge:gap-1.5 forge:px-0.5"><strong class="forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:font-mono forge:text-[11px] forge:font-medium forge:text-text-primary" :title="item.label">{{ item.label }}</strong><span class="forge:flex-none forge:rounded-[5px] forge:bg-bg-input-hover forge:px-1.5 forge:py-0.5 forge:font-mono forge:text-[8px] forge:font-semibold forge:tracking-[.06em] forge:text-text-muted">{{ rail.badge }}</span></div>
            <div class="forge:flex forge:items-baseline forge:justify-between forge:gap-1.5 forge:px-0.5 forge:font-mono forge:text-[9px] forge:font-medium forge:text-text-muted"><span class="forge:uppercase forge:tracking-[.06em] forge:text-text-secondary" :title="item.runId">{{ item.runLabel }}</span><time class="forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap" :datetime="item.createdAt">{{ new Date(item.createdAt).toLocaleString() }}</time></div>
            <button v-if="rail.key === 'models' && onCanvas(item.nodeId)" type="button" class="forge:absolute forge:right-3.5 forge:top-3.5 forge:grid forge:size-[26px] forge:place-items-center forge:rounded-[7px] forge:border-0 forge:bg-[color-mix(in_srgb,var(--bg-card)_82%,transparent)] forge:p-0 forge:text-[13px] forge:leading-none forge:text-text-secondary forge:opacity-0 forge:backdrop-blur forge:transition-[opacity,background,color] forge:group-hover:opacity-100 forge:hover:bg-acid forge:hover:text-text-inverse" title="Open in Model Editor" @click="emit('open-model-editor', item.nodeId)">↗</button>
          </article>
        </div>
        <p v-else class="forge:px-0.5 forge:py-5 forge:font-mono forge:text-[10px] forge:font-medium forge:tracking-[.04em] forge:text-text-muted">No {{ rail.title.toLowerCase() }} yet</p>
      </section>
    </template>
  </div>
</template>
