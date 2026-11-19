// Echo in 3D, with React Three Fiber. Loaded on its own (EchoRobot lazy-loads it), so three.js never slows the first page.
//   expression -> eye shape and glow colour          pose -> head, antenna and hands
//   speechBands -> the five mouth bars follow Echo's real voice (Web Audio AnalyserNode in audio.ts)
//   idle -> hovers, blinks, and turns its head towards the pointer (not under reduced motion)

import { Environment, Lightformer, useGLTF } from '@react-three/drei'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ROBOT_COLORS } from '../../echo.config'
import { EYES, GLOW, reducedMotion, ROBOT_MODEL, type RobotExpression, type RobotPose } from './robot'

type Props = {
  pose: RobotPose
  expression: RobotExpression
  speechBands?: (count: number) => number[] | null
  onActivate?: () => void
}

const MOUTH_BARS = 5
/** Each step moves this fraction of the way to its target: higher is snappier. */
const EASE = 10

const damp = (current: number, target: number, delta: number, speed = EASE) => THREE.MathUtils.damp(current, target, speed, delta)

type Parts = {
  root: THREE.Object3D
  head: THREE.Object3D
  eyes: THREE.Object3D[]
  eyeHome: THREE.Vector3[]
  mouth: THREE.Object3D[]
  antenna: THREE.Object3D
  tip: THREE.Object3D
  handL: THREE.Object3D
  handR: THREE.Object3D
  handRHome: THREE.Vector3
  glow: THREE.MeshStandardMaterial
}

function useEcho(): { scene: THREE.Object3D; parts: Parts } {
  const { scene: source } = useGLTF(ROBOT_MODEL)
  return useMemo(() => {
    // A copy per robot, with its own materials, so two robots (or a recolour) never share state.
    const scene = source.clone(true)
    const materials = new Map<string, THREE.Material>()
    scene.traverse(node => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const original = mesh.material as THREE.MeshStandardMaterial
      let copy = materials.get(original.name)
      if (!copy) {
        const made = original.clone()
        if (made.name === 'Shell') made.color.set(ROBOT_COLORS.shell)
        if (made.name === 'Glow') {
          made.color.set(ROBOT_COLORS.glow)
          made.emissive.set(ROBOT_COLORS.glow)
          made.toneMapped = false // so it is bright enough to bloom
        }
        materials.set(original.name, made)
        copy = made
      }
      mesh.material = copy
    })
    const find = (name: string) => {
      const node = scene.getObjectByName(name)
      if (!node) throw new Error(`echo.glb has no node named ${name}: rebuild it with blender/build_echo.py`)
      return node
    }
    const eyes = [find('EyeL'), find('EyeR')]
    const parts: Parts = {
      root: find('EchoRoot'), head: find('HeadPivot'), eyes, eyeHome: eyes.map(eye => eye.position.clone()),
      mouth: Array.from({ length: MOUTH_BARS }, (_, i) => find(`Mouth${i}`)),
      antenna: find('AntennaPivot'), tip: find('AntennaTip'), handL: find('HandLPivot'), handR: find('HandRPivot'), handRHome: find('HandRPivot').position.clone(),
      glow: materials.get('Glow') as THREE.MeshStandardMaterial,
    }
    return { scene, parts }
  }, [source])
}

function Robot({ pose, expression, speechBands, onActivate }: Props) {
  const { scene, parts } = useEcho()
  const pointer = useRef(new THREE.Vector2())
  const blink = useRef({ next: 2 + Math.random() * 3, until: 0 })
  const nod = useRef(0)
  const calm = useMemo(reducedMotion, [])
  const glowColor = useMemo(() => new THREE.Color(), [])
  const level = useRef(0)

  // The head follows the pointer anywhere on the page, not only over the canvas.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      pointer.current.set((event.clientX / window.innerWidth) * 2 - 1, -((event.clientY / window.innerHeight) * 2 - 1))
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  // A nod when Echo starts listening.
  useEffect(() => { if (pose === 'listening') nod.current = 1 }, [pose])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const { root, head, eyes, eyeHome, mouth, antenna, tip, handL, handR, handRHome, glow } = parts

    // Hover and sway.
    root.position.y = calm ? 0 : Math.sin(t * 1.6) * 0.035
    handL.rotation.x = calm ? 0 : Math.sin(t * 1.6 + 0.6) * 0.08
    handR.rotation.x = calm ? 0 : Math.sin(t * 1.6 + 1.1) * 0.08

    // Head: towards the pointer, plus the pose.
    const look = calm ? { x: 0, y: 0 } : { x: pointer.current.x * 0.45, y: pointer.current.y * 0.2 }
    nod.current = Math.max(0, nod.current - delta * 1.8)
    const nodding = calm ? 0 : Math.sin((1 - nod.current) * Math.PI * 2) * 0.18 * nod.current
    const tilt = pose === 'thinking' ? 0.2 : 0
    const lean = pose === 'listening' ? 0.08 : pose === 'thinking' ? -0.1 : 0
    head.rotation.y = damp(head.rotation.y, look.x, delta, 4)
    head.rotation.x = damp(head.rotation.x, -look.y + lean + nodding, delta, 6)
    head.rotation.z = damp(head.rotation.z, tilt, delta, 4)

    // Hands: thinking brings the right hand up under the visor, like a hand on the chin; talking moves the left with the voice.
    const thinking = pose === 'thinking'
    handR.position.x = damp(handR.position.x, handRHome.x + (thinking ? -0.26 : 0), delta, 5)
    handR.position.y = damp(handR.position.y, handRHome.y + (thinking ? 0.42 : 0), delta, 5)
    handR.position.z = damp(handR.position.z, handRHome.z + (thinking ? 0.4 : 0), delta, 5)
    handL.rotation.z = damp(handL.rotation.z, pose === 'talking' && !calm ? -level.current * 0.4 : 0, delta, 8)

    // Antenna: wiggles while thinking; its tip pulses while listening.
    antenna.rotation.z = calm ? 0 : pose === 'thinking' ? Math.sin(t * 9) * 0.12 : damp(antenna.rotation.z, 0, delta)
    const pulse = pose === 'listening' ? 1 + Math.sin(t * 5) * 0.18 : 1
    tip.scale.setScalar(damp(tip.scale.x, pulse, delta, 12))

    // Eyes: the face's shape, and a blink every few seconds (never while resting: they are already shut).
    const shape = EYES[expression]
    if (t > blink.current.next && expression !== 'resting') {
      blink.current.until = t + 0.12
      blink.current.next = t + 2.5 + Math.random() * 4
    }
    const blinking = t < blink.current.until
    eyes.forEach((eye, i) => {
      eye.scale.x = damp(eye.scale.x, shape.sx, delta, 12)
      eye.scale.y = damp(eye.scale.y, blinking ? 0.1 : shape.sy, delta, blinking ? 40 : 12)
      eye.position.x = damp(eye.position.x, eyeHome[i].x + shape.lookX, delta, 8)
      eye.position.y = damp(eye.position.y, eyeHome[i].y + shape.lookY, delta, 8)
    })

    // Glow colour and strength for the face.
    const face = GLOW[expression]
    glowColor.set(face.color ?? ROBOT_COLORS.glow)
    glow.emissive.lerp(glowColor, Math.min(1, delta * 6))
    glow.color.lerp(glowColor, Math.min(1, delta * 6))
    glow.emissiveIntensity = damp(glow.emissiveIntensity, face.intensity, delta, 6)

    // Mouth: the voice's loudness in five bands while it talks, resting flat otherwise.
    const bands = pose === 'talking' ? speechBands?.(MOUTH_BARS) ?? null : null
    let sum = 0
    mouth.forEach((bar, i) => {
      // Louder in the middle of the mouth: the speech bands come low pitch first, so play them out from the centre.
      const band = bands ? bands[[2, 1, 3, 0, 4][i]] : 0
      sum += band
      bar.scale.y = damp(bar.scale.y, 1 + band * 2.2, delta, 22)
    })
    level.current = bands ? sum / MOUTH_BARS : damp(level.current, 0, delta)
  })

  const click = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onActivate?.() }
  return <primitive object={scene} onClick={click}
    onPointerOver={() => { document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = '' }} />
}

export default function EchoScene(props: Props) {
  return (
    <Canvas camera={{ position: [0, 1.2, 6.4], fov: 26 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}
      onCreated={({ camera }) => camera.lookAt(0, 1.08, 0)}>
      {/* Studio light made here, so nothing is fetched from another site. */}
      <Environment resolution={128}>
        <Lightformer intensity={2.2} position={[0, 4, 3]} scale={[8, 3, 1]} />
        <Lightformer intensity={1.2} position={[-4, 1, 2]} scale={[3, 5, 1]} />
        <Lightformer intensity={0.8} position={[4, 0, -2]} scale={[3, 5, 1]} color="#ffd9c7" />
      </Environment>
      <ambientLight intensity={0.35} />
      <directionalLight position={[2, 4, 4]} intensity={1.4} />
      <Robot {...props} />
      <EffectComposer multisampling={4}>
        {/* Only the glowing parts (emissive, not tone mapped) pass the threshold; a small radius keeps the halo inside the canvas. */}
        <Bloom mipmapBlur luminanceThreshold={1.4} luminanceSmoothing={0.2} intensity={0.55} radius={0.32} />
      </EffectComposer>
    </Canvas>
  )
}

useGLTF.preload(ROBOT_MODEL)
