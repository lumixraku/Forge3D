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
  <div class="asset-library">
    <div v-if="loading && !total" class="asset-empty">
      <strong>Loading assets…</strong>
      <span>Reading this canvas's run history.</span>
    </div>
    <div v-else-if="!total" class="asset-empty">
      <strong>No assets yet</strong>
      <span>References, generated 2D images and 3D models from every run of this canvas collect here.</span>
    </div>
    <template v-else>
      <section v-for="rail in rails" :key="rail.key" class="asset-rail">
        <header class="asset-rail-header">
          <div><span>{{ rail.title }}</span><b>{{ rail.items.length }}</b></div>
          <div v-if="rail.items.length" class="asset-rail-nav">
            <button type="button" aria-label="Scroll left" @click="scrollRail($event, -1)">‹</button>
            <button type="button" aria-label="Scroll right" @click="scrollRail($event, 1)">›</button>
          </div>
        </header>
        <div v-if="rail.items.length" class="asset-rail-track">
          <article v-for="item in rail.items" :key="item.id" class="asset-card">
            <button type="button" class="asset-card-thumb" @click="emit('preview', { src: item.src, alt: item.label })"><img :src="item.src" :alt="item.label" loading="lazy" /></button>
            <div class="asset-card-meta"><strong :title="item.label">{{ item.label }}</strong><span class="asset-card-badge">{{ rail.badge }}</span></div>
            <div class="asset-card-run"><span :title="item.runId">{{ item.runLabel }}</span><time :datetime="item.createdAt">{{ new Date(item.createdAt).toLocaleString() }}</time></div>
            <button v-if="rail.key === 'models' && onCanvas(item.nodeId)" type="button" class="asset-card-open" title="Open in Model Editor" @click="emit('open-model-editor', item.nodeId)">↗</button>
          </article>
        </div>
        <p v-else class="asset-rail-empty">No {{ rail.title.toLowerCase() }} yet</p>
      </section>
    </template>
  </div>
</template>
