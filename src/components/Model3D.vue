<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

// A real interactive three.js viewer for the workflow's 3D model.
// mode: 'model' (solid) | 'wireframe' | 'rig' (skeleton overlay) | 'split' (exploded mesh parts)
type ViewerMode = 'model' | 'wireframe' | 'rig' | 'split'

const props = withDefaults(defineProps<{
  mode?: ViewerMode
  src?: string
  // Tripo AI part-segmentation result: each node is a real semantic part.
  segSrc?: string
  autoRotate?: boolean
}>(), { mode: 'model', src: '/models/shark-gardener.glb', segSrc: '/models/shark-gardener-segmented.glb', autoRotate: true })

const host = ref<HTMLElement | null>(null)
let renderer: THREE.WebGLRenderer | undefined
let scene: THREE.Scene | undefined
let camera: THREE.PerspectiveCamera | undefined
let controls: OrbitControls | undefined
let pivot: THREE.Group | undefined
let raf: number | undefined
let resizeObserver: ResizeObserver | undefined
let disposed = false

function fitAndCenter(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)
  geometry.translate(-center.x, -center.y, -center.z)
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
  let mesh: THREE.Mesh | undefined
  root.updateMatrixWorld(true)
  root.traverse((object) => { if (!mesh && object instanceof THREE.Mesh) mesh = object })
  if (!mesh) return root

  const geo = mesh.geometry.clone()
  geo.applyMatrix4(mesh.matrixWorld)
  const size = fitAndCenter(geo)
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material

  const content = new THREE.Group()
  if (mode === 'rig') {
    const mat = material.clone()
    mat.transparent = true
    mat.opacity = 0.55
    content.add(new THREE.Mesh(geo, mat))
    content.add(buildSkeleton(size))
  } else if (mode === 'wireframe') {
    const mat = material.clone()
    mat.wireframe = true
    content.add(new THREE.Mesh(geo, mat))
  } else {
    content.add(new THREE.Mesh(geo, material))
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
  const url = props.mode === 'split' ? props.segSrc : props.src
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  loader.load(url, (gltf) => {
    if (disposed || !pivot) return
    pivot.add(props.mode === 'split' ? explodeParts(gltf.scene, 0.38) : applyMode(gltf.scene, props.mode))
  })
}

function rebuild() {
  if (!pivot) return
  for (let i = pivot.children.length - 1; i >= 0; i--) pivot.remove(pivot.children[i])
  pivot.rotation.set(0, 0, 0)
  loadContent()
}

onMounted(init)
watch(() => props.mode, rebuild)

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
  <div ref="host" class="model3d nodrag nopan" />
</template>

<style scoped>
.model3d {
  width: 100%;
  height: 100%;
  min-height: 180px;
  position: relative;
}
.model3d :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
  border-radius: inherit;
  cursor: grab;
}
.model3d :deep(canvas:active) { cursor: grabbing; }
</style>
