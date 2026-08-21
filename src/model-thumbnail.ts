import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

function loadModel(url: string) {
  return new Promise<THREE.Group>((resolve, reject) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(url, ({ scene }) => resolve(scene), undefined, reject)
  })
}

export async function createModelThumbnail(file: File) {
  const sourceUrl = URL.createObjectURL(file)
  let renderer: THREE.WebGLRenderer | undefined
  try {
    const model = await loadModel(sourceUrl)
    const size = 512
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'low-power' })
    renderer.setSize(size, size, false)
    renderer.setPixelRatio(1)
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x161b18)
    const environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04)
    scene.environment = environment.texture
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7a68, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(3, 5, 4)
    scene.add(key)

    const box = new THREE.Box3().setFromObject(model)
    const center = box.getCenter(new THREE.Vector3())
    const dimensions = box.getSize(new THREE.Vector3())
    const radius = Math.max(dimensions.x, dimensions.y, dimensions.z) || 1
    model.position.sub(center)
    model.rotation.y = Math.PI / 6
    scene.add(model)

    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, radius * 20)
    camera.position.set(radius * 1.4, radius * 0.9, radius * 2.6)
    camera.lookAt(0, 0, 0)
    renderer.render(scene, camera)

    return await new Promise<Blob>((resolve, reject) => renderer!.domElement.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not create model thumbnail')), 'image/png'))
  } finally {
    renderer?.dispose()
    URL.revokeObjectURL(sourceUrl)
  }
}
