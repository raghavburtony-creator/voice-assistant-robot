// Otto as the Clay Robot (web/src/components/originkit/ui/clay-robot.tsx, from Originkit). Loaded on its own (OttoRobot
// lazy-loads it). The robot keeps its own life (follows the cursor, blinks, glances, hops when tapped); this file drives it
// from outside through its `control` hook, once per frame inside the robot's own loop:
//   pose        -> listening leans in; thinking holds the thinkingHand gesture (GESTURE_SETTINGS.whileThinking)
//   expression  -> eye shape, gaze, glow and colour (FACES in robot.ts)
//   speechBands -> the five mouth bars follow Otto's real voice (Web Audio AnalyserNode in audio.ts)
//   gestures    -> waves, nods... (gestures.ts), layered on top of all of the above; their starts and ends go back out on
//                  the same channel (channel.onEvent)

import { useEffect, useMemo, useRef } from 'react'
import ClayRobot, { type ClayControl } from '../../components/originkit/ui/clay-robot'
import { GESTURE_SETTINGS, ROBOT_BACKGROUND, ROBOT_COLORS } from '../../otto.config'
import { createGestureController, type GestureChannel } from './gestures'
import { FACES, useReducedMotion, type RobotExpression, type RobotPose } from './robot'

type Props = {
  pose: RobotPose
  expression: RobotExpression
  speechBands?: (count: number) => number[] | null
  onActivate?: () => void
  /** Gesture requests (waves, nods...) from app code. */
  gestures?: GestureChannel
}

const MOUTH_BARS = 5
/** The speech bands come low pitch first, so play them out from the centre of the mouth. */
const MOUTH_ORDER = [2, 1, 3, 0, 4]
const damp = (current: number, target: number, speed: number, dt: number) => current + (target - current) * (1 - Math.exp(-speed * dt))

function hexToRGB(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export default function ClayScene({ pose, expression, speechBands, onActivate, gestures }: Props) {
  const calm = useReducedMotion()
  // Gesture starts and ends go out through whichever channel this robot is given.
  const channel = useRef(gestures)
  useEffect(() => { channel.current = gestures }, [gestures])
  const controller = useMemo(() => createGestureController({
    onEvent: event => channel.current?.emit(event),
    intensity: GESTURE_SETTINGS.enabled ? GESTURE_SETTINGS.intensity : 0,
    reducedIntensity: GESTURE_SETTINGS.reducedIntensity, cooldown: GESTURE_SETTINGS.cooldown,
  }), [])

  // What the per-frame update reads; refreshed every render, never rebuilds the robot.
  const live = useRef({ pose, expression, speechBands, calm })
  useEffect(() => { live.current = { pose, expression, speechBands, calm } })

  useEffect(() => { controller.setReducedMotion(calm) }, [controller, calm])
  // The pose layer: thinking holds a gesture (hand on the chin) until the pose changes.
  useEffect(() => { controller.hold(pose === 'thinking' ? GESTURE_SETTINGS.whileThinking : null) }, [controller, pose])
  // Gestures requested from outside.
  useEffect(() => gestures?.subscribe(command => {
    if (command.type === 'play') controller.play(command.name, command.options)
    else if (command.type === 'hold') controller.hold(command.name, command.options)
    else controller.stop()
  }), [controller, gestures])

  const control = useMemo<ClayControl>(() => {
    const defaultEyes = hexToRGB(ROBOT_COLORS.eyes)
    const eyeColor: [number, number, number] = [...defaultEyes]
    // The damped base layer: face, lean, voice level.
    const base = { open: 1, joy: 0, lookX: 0, lookY: 0, glow: FACES.happy.glow, lean: 0, level: 0 }
    const bars = new Float32Array(MOUTH_BARS)
    let settled = false

    const ctl: ClayControl = {
      look: 1, yaw: 0, pitch: 0, roll: 0, lift: 0, squash: 0,
      armL: { raise: 0, swing: 0, ext: 0 }, armR: { raise: 0, swing: 0, ext: 0 }, baseL: 1, baseR: 1,
      eyeOpen: 1, joy: 0, eyeX: 0, eyeY: 0, glow: base.glow, eyeColor, mouth: bars, mouthOn: 0,
      update(dt) {
        const { pose: p, expression: e, speechBands: sb, calm: still } = live.current
        const g = controller.update(dt)
        const face = FACES[e]
        const before = base.open + base.joy + base.lookX + base.lookY + base.glow + base.lean + base.level + ctl.mouthOn

        // Face and lean, eased so a change of state never snaps.
        base.open = damp(base.open, face.open, 12, dt)
        base.joy = damp(base.joy, face.joy, 10, dt)
        base.lookX = damp(base.lookX, face.lookX, 8, dt)
        base.lookY = damp(base.lookY, face.lookY, 8, dt)
        base.glow = damp(base.glow, face.glow, 6, dt)
        base.lean = damp(base.lean, p === 'listening' ? 0.08 : 0, 6, dt)
        const target = face.color ? hexToRGB(face.color) : defaultEyes
        for (let i = 0; i < 3; i++) eyeColor[i] = damp(eyeColor[i], target[i], 6, dt)

        // Mouth: the voice's loudness in five bands while it talks; it fades away when Otto is quiet.
        const bands = p === 'talking' ? sb?.(MOUTH_BARS) ?? null : null
        let sum = 0
        for (let i = 0; i < MOUTH_BARS; i++) {
          const band = bands ? bands[MOUTH_ORDER[i]] : 0
          sum += band
          bars[i] = damp(bars[i], band, 22, dt)
        }
        base.level = bands ? sum / MOUTH_BARS : damp(base.level, 0, 10, dt)
        ctl.mouthOn = damp(ctl.mouthOn, p === 'talking' ? 1 : 0, 8, dt)

        // Head: the cursor (less while a gesture plays; none with reduced motion), the lean, the gesture.
        // Clay's +pitch looks up and gestures' +rx dips the face, hence the minus.
        ctl.look = still ? 0 : g.look
        ctl.pitch = -(base.lean + g.head.rx)
        ctl.yaw = g.head.ry
        ctl.roll = -g.head.rz
        ctl.lift = g.head.lift
        ctl.squash = still ? 0 : base.level * 0.05
        ctl.armL.raise = g.handL.raise; ctl.armL.swing = g.handL.swing; ctl.armL.ext = g.handL.ext
        ctl.armR.raise = g.handR.raise; ctl.armR.swing = g.handR.swing; ctl.armR.ext = g.handR.ext
        ctl.baseL = g.baseL
        ctl.baseR = g.baseR
        ctl.eyeOpen = base.open
        ctl.joy = Math.max(base.joy, g.face.joy)
        ctl.eyeX = base.lookX + g.face.lookX
        ctl.eyeY = base.lookY + g.face.lookY
        ctl.glow = base.glow + base.level * 0.6

        // Keep the robot drawing while anything here moves; let it rest once everything has settled.
        const after = base.open + base.joy + base.lookX + base.lookY + base.glow + base.lean + base.level + ctl.mouthOn
        const moving = controller.busy() || bands !== null || Math.abs(after - before) > 1e-4
        if (moving) { settled = false; return true }
        if (!settled) { settled = true; return true } // one last frame at rest
        return false
      },
    }
    return ctl
  }, [controller])

  return (
    <div onClick={onActivate} style={{ inlineSize: '100%', blockSize: '100%' }}>
      <ClayRobot
        control={control}
        colors={ROBOT_COLORS}
        transparent={ROBOT_BACKGROUND.transparent}
        background={{ top: ROBOT_BACKGROUND.top, bottom: ROBOT_BACKGROUND.bottom, shadow: ROBOT_BACKGROUND.shadow, shadowDepth: ROBOT_BACKGROUND.transparent ? 40 : 24 }}
        // Otto's own gestures do the waving; walking about would leave the dock.
        wave={false}
        walk={false}
        animate={false}
        glance={calm ? 0 : 4}
        response={{ track: 'page', headTurn: 7, eyeTravel: 6, followSpeed: 6, hop: calm ? 0 : 4 }}
        style={{ borderRadius: 'inherit' }}
      />
    </div>
  )
}
