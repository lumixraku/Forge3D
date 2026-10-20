<script setup lang="ts">
import { computed, defineExpose, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

// A real interactive three.js viewer for the canvas's 3D model.
// mode: 'model' (solid) | 'wireframe' | 'rig' (skeleton overlay) | 'split' (exploded mesh parts)
type ViewerMode = 'model' | 'wireframe' | 'rig' | 'split'

const props = withDefaults(defineProps<{
  mode?: ViewerMode
  src: string
  // Tripo AI part-segmentation result: each node is a real semantic part.
  segSrc?: string
  autoRotate?: boolean
}>(), { mode: 'model', segSrc: undefined, autoRotate: true })

const host = ref<HTMLElement | null>(null)
const loading = ref(false)
const loadedBytes = ref(0)
const totalBytes = ref(0)
const loadError = ref('')
const progressLabel = computed(() => {
  const loaded = formatBytes(loadedBytes.value)
  if (totalBytes.value > 0) {
    const ratio = (loadedBytes.value / totalBytes.value) * 100
    const percent = ratio > 0 && ratio < 10 ? ratio.toFixed(1) : Math.min(100, Math.round(ratio))
    return `${loaded} / ${formatBytes(totalBytes.value)} · ${percent}%`
  }
  if (loadedBytes.value > 0) return `${loaded} loaded`
  return 'Waiting for the file size'
})
const progressWidth = computed(() => {
  if (totalBytes.value <= 0) return '0%'
  return `${Math.min(100, (loadedBytes.value / totalBytes.value) * 100)}%`
})

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

let renderer: THREE.WebGLRenderer | undefined
let scene: THREE.Scene | undefined
let camera: THREE.PerspectiveCamera | undefined
let controls: OrbitControls | undefined
let pivot: THREE.Group | undefined
let raf: number | undefined
let resizeObserver: ResizeObserver | undefined
let disposed = false
let loadToken = 0

function fitAndCenter(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)
  root.position.sub(center)
  return size
}

// Explode the real Tripo part-segmentation result: each mesh node is a semantic
// part; push each part outward from the model centre so they separate in 3D.
function explodeParts(root: THREE.Group, explodeFactor: number) {
  root.updateMatrixWorld(true)
  const meshes: THREE.Mesh[] = []
  root.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object) })

  const box = new THREE.Box3().setFromObject(root)
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)
  const maxDim = Math.max(size.x, size.y, size.z) || 1

  const content = new THREE.Group()
  for (const m of meshes) {
    const geo = m.geometry.clone()
    geo.applyMatrix4(m.matrixWorld)
    geo.computeBoundingBox()
    const partCenter = new THREE.Vector3()
    geo.boundingBox.getCenter(partCenter)
    geo.translate(-center.x, -center.y, -center.z)
    const mesh = new THREE.Mesh(geo, m.material)
    const dir = partCenter.clone().sub(center)
    if (dir.lengthSq() > 1e-6) dir.normalize()
    mesh.position.copy(dir.multiplyScalar(maxDim * explodeFactor))
    content.add(mesh)
  }
  const scale = 2 / maxDim
  content.scale.setScalar(scale)
  return content
}

function buildSkeleton(size: THREE.Vector3) {
  const sx = size.x, sy = size.y, sz = size.z
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x * sx, y * sy, z * sz)
  const head = P(0, 0.44, 0.02), neck = P(0, 0.30, 0), chest = P(0, 0.12, 0), pelvis = P(0, -0.10, 0)
  const shL = P(-0.13, 0.14, 0), shR = P(0.13, 0.14, 0)
  const elbowL = P(-0.22, -0.02, 0.02), elbowR = P(0.22, -0.02, 0.02)
  const handL = P(-0.26, -0.16, 0.04), handR = P(0.26, -0.16, 0.04)
  const hipL = P(-0.09, -0.12, 0), hipR = P(0.09, -0.12, 0)
  const kneeL = P(-0.10, -0.32, 0.02), kneeR = P(0.10, -0.32, 0.02)
  const footL = P(-0.10, -0.48, 0.04), footR = P(0.10, -0.48, 0.04)
  const bones = [
    [head, neck], [neck, chest], [chest, pelvis],
    [chest, shL], [shL, elbowL], [elbowL, handL],
    [chest, shR], [shR, elbowR], [elbowR, handR],
    [pelvis, hipL], [hipL, kneeL], [kneeL, footL],
    [pelvis, hipR], [hipR, kneeR], [kneeR, footR],
  ]
  const joints = [head, neck, chest, pelvis, shL, shR, elbowL, elbowR, handL, handR, hipL, hipR, kneeL, kneeR, footL, footR]
  const group = new THREE.Group()
  const pts = []
  for (const [a, b] of bones) pts.push(a, b)
  const lineGeo = new THREE.BufferGeometry().setFromPoints(pts)
  group.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x33691e, depthTest: false, transparent: true })))
  const r = Math.max(sx, sy, sz) * 0.022
  const jointGeo = new THREE.SphereGeometry(r, 16, 12)
  const jointMat = new THREE.MeshBasicMaterial({ color: 0x8bc34a, depthTest: false })
  for (const j of joints) {
    const s = new THREE.Mesh(jointGeo, jointMat)
    s.position.copy(j)
    group.add(s)
  }
  group.renderOrder = 2
  return group
}

function applyMode(root: THREE.Group, mode: ViewerMode) {
  const content = root
  const size = fitAndCenter(content)
  const maxDim = Math.max(size.x, size.y, size.z) || 1

  if (mode === 'rig') {
    content.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      object.material = materials.map((material) => {
        const transparent = material.clone()
        transparent.transparent = true
        transparent.opacity = 0.55
        return transparent
      })
    })
    content.add(buildSkeleton(size))
  } else if (mode === 'wireframe') {
    content.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      object.material = materials.map((material) => {
        const wireframe = material.clone()
        wireframe.wireframe = true
        return wireframe
      })
    })
  }
  const scale = 2 / maxDim
  content.scale.setScalar(scale)
  return content
}

function init() {
  const el = host.value
  if (!el) return
  const width = el.clientWidth || 320
  const height = el.clientHeight || 320

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(width, height)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  el.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

  camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100)
  camera.position.set(0.4, 0.6, 4.0)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7a68, 1.1))
  const key = new THREE.DirectionalLight(0xffffff, 1.5)
  key.position.set(3, 5, 4)
  scene.add(key)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.minDistance = 1.8
  controls.maxDistance = 7

  pivot = new THREE.Group()
  scene.add(pivot)

  loadContent()

  const clock = new THREE.Clock()
  const loop = () => {
    raf = requestAnimationFrame(loop)
    if (props.autoRotate) pivot!.rotation.y += clock.getDelta() * 0.4
    else clock.getDelta()
    controls!.update()
    renderer!.render(scene!, camera!)
  }
  loop()

  resizeObserver = new ResizeObserver(() => {
    if (!renderer) return
    const w = el.clientWidth, h = el.clientHeight
    if (!w || !h) return
    camera!.aspect = w / h
    camera!.updateProjectionMatrix()
    renderer.setSize(w, h)
  })
  resizeObserver.observe(el)
}

function loadContent() {
  const url = props.mode === 'split' ? props.segSrc || props.src : props.src
  const token = ++loadToken
  loadedBytes.value = 0
  totalBytes.value = 0
  loadError.value = ''
  if (!url) {
    loading.value = false
    return
  }
  loading.value = true
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  loader.load(url, (gltf) => {
    if (disposed || !pivot || token !== loadToken) return
    pivot.add(props.mode === 'split' ? explodeParts(gltf.scene, 0.38) : applyMode(gltf.scene, props.mode))
    loading.value = false
  }, (event) => {
    if (token !== loadToken) return
    loadedBytes.value = event.loaded
    if (event.lengthComputable && event.total > 0) totalBytes.value = event.total
  }, () => {
    if (disposed || token !== loadToken) return
    loading.value = false
    loadError.value = 'Could not load the model.'
  })
}

function rebuild() {
  if (!pivot) return
  for (let i = pivot.children.length - 1; i >= 0; i--) pivot.remove(pivot.children[i])
  pivot.rotation.set(0, 0, 0)
  loadContent()
}

function snapshot() {
  if (!renderer || !scene || !camera || !pivot?.children.length) return ''
  renderer.render(scene, camera)
  const source = renderer.domElement
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  const ctx = out.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#202322'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(source, 0, 0)
  return out.toDataURL('image/png')
}

defineExpose({ snapshot })

onMounted(init)
watch(() => [props.mode, props.src, props.segSrc], () => {
  if (pivot) rebuild()
})

onBeforeUnmount(() => {
  disposed = true
  if (raf) cancelAnimationFrame(raf)
  if (resizeObserver) resizeObserver.disconnect()
  if (controls) controls.dispose()
  if (renderer) {
    renderer.dispose()
    renderer.domElement?.remove()
  }
  renderer = scene = camera = controls = pivot = null
})
</script>

<template>
  <div class="forge3d-model3d nodrag nopan forge:relative forge:h-full forge:min-h-[180px] forge:w-full">
    <div ref="host" class="forge3d-model3d-view" />
    <div v-if="loading || loadError" class="forge3d-model-load" role="status" aria-live="polite">
      <div class="forge3d-model-load-card">
        <span v-if="loading" class="forge3d-model-load-spin" />
        <strong>{{ loadError || 'Loading model' }}</strong>
        <p v-if="loading">{{ progressLabel }}</p>
        <div v-if="loading" class="forge3d-model-load-bar" :class="{ 'forge3d-indeterminate': totalBytes <= 0 }">
          <span :style="{ width: progressWidth }" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.forge3d-model3d-view { position: absolute; inset: 0; }
.forge3d-model3d :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
  border-radius: inherit;
  cursor: grab;
}
.forge3d-model3d :deep(canvas:active) { cursor: grabbing; }
.forge3d-model-load {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: grid;
  place-content: center;
  pointer-events: none;
  color: #e7ece8;
  font-family: var(--font-mono);
  text-align: center;
}
.forge3d-model-load-card {
  display: grid;
  justify-items: center;
  gap: 10px;
  min-width: 220px;
  padding: 18px 20px 16px;
  border-radius: 12px;
  background: rgba(18, 22, 20, 0.88);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.forge3d-model-load-spin {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(255, 255, 255, 0.22);
  border-top-color: var(--acid);
  border-radius: 50%;
  animation: model-loading 0.8s linear infinite;
}
.forge3d-model-load strong {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.forge3d-model-load p {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
}
.forge3d-model-load-bar {
  width: 196px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
}
.forge3d-model-load-bar > span {
  display: block;
  height: 100%;
  background: var(--acid);
}
.forge3d-model-load-bar.forge3d-indeterminate > span {
  width: 40% !important;
  animation: model-loading-bar 1.1s ease-in-out infinite;
}
@keyframes model-loading { to { transform: rotate(360deg); } }
@keyframes model-loading-bar {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(320%); }
}
@media (prefers-reduced-motion: reduce) {
  .forge3d-model-load-spin, .forge3d-model-load-bar.forge3d-indeterminate > span { animation: none; }
}
</style>
