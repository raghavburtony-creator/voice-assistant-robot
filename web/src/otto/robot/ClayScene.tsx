// Otto as the Clay Robot (web/src/components/originkit/ui/clay-robot.tsx, from Originkit). Loaded on its own (OttoRobot
// lazy-loads it). The robot keeps its own life (follows the cursor, blinks, glances, hops when tapped); this file drives it
// from outside through its `control` hook, once per frame inside the robot's own loop:
//   pose        -> listening leans in; thinking holds the thinkingHand gesture (GESTURE_SETTINGS.whileThinking)
//   expression  -> eye shape, tilt, size, gaze, glow, colour, head pose and blink rate (FACES in robot.ts), all eased
//   mouth       -> five bars from the voice's speech bands (mouth.ts: the same analyzer for every voice source)
//   gestures    -> waves, nods... (gestures.ts), layered on top of all of the above; their starts and ends go back out on
//                  the same channel (channel.onEvent)
//   locomotion  -> the stage (movement/stage.ts) moves the robot's frame across the page; here the legs walk to match it,
//                  the body turns and leans the way it goes, the head leads, and cursor tracking fades out while walking
//                  and back in on arrival. A stage `gaze` aims the head and eyes at a point instead of the cursor.
//   asleep      -> slow breathing, chin down, no cursor tracking (the face itself is the `resting` expression)

import { useEffect, useMemo, useRef } from 'react'
import ClayRobot, { type ClayControl } from '../../components/originkit/ui/clay-robot'
import { GESTURE_SETTINGS, ROBOT_BACKGROUND, ROBOT_COLORS } from '../../otto.config'
import { MOUTH_BARS, type MouthSource } from '../mouth'
import type { StageFrame } from '../movement/stage'
import { createGestureController, type GestureChannel } from './gestures'
import { FACES, useReducedMotion, type FaceShape, type RobotExpression, type RobotPose } from './robot'

type Props = {
  pose: RobotPose
  expression: RobotExpression
  /** Otto's mouth (mouth.ts), read every frame while talking. */
  mouth?: MouthSource
  onActivate?: () => void
  /** Gesture requests (waves, nods...) from app code. */
  gestures?: GestureChannel
  /** The stage's frame (movement/stage.ts), read every frame while Otto walks. */
  locomotion?: StageFrame
  /** Dozing (idle.ts): slow breathing, head down, not following the cursor. */
  asleep?: boolean
}

/** How far the body turns at full heading (rad), and how much further the head leads into the way it is going. */
const BODY_TURN = 0.62
const HEAD_LEAD = 0.24
/** Lean into the walk at top speed (rad). Clay's body roll: + tips the top toward the viewer's left. */
const LEAN = -0.07
/** Sleep: breaths a second (awake, the robot's own rhythm has none), head bowed (rad). */
const SLEEP_BREATH_HZ = 0.17
const SLEEP_BOW = 0.16

/** Frame-rate independent easing: `speed` is the rate (1/s) of an exponential approach. */
const damp = (current: number, target: number, speed: number, dt: number) => current + (target - current) * (1 - Math.exp(-speed * dt))
/** How fast each face value eases toward a new face (1/s). Shape is quick, colour and glow slower, head pose slowest. */
const FACE_SPEED: { [K in Exclude<keyof FaceShape, 'color'>]: number } = {
  open: 12, joy: 10, lookX: 8, lookY: 8, glow: 6, tilt: 9, scaleL: 9, scaleR: 9, roll: 5, pitch: 5, blink: 4,
}
type FaceKey = keyof typeof FACE_SPEED
const FACE_KEYS = Object.keys(FACE_SPEED) as FaceKey[]

function hexToRGB(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export default function ClayScene({ pose, expression, mouth, onActivate, gestures, locomotion, asleep = false }: Props) {
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
  const live = useRef({ pose, expression, mouth, calm, locomotion, asleep })
  useEffect(() => { live.current = { pose, expression, mouth, calm, locomotion, asleep } })

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
    // The eased base layer: every face value, the lean and the voice level.
    const face: Record<FaceKey, number> = Object.fromEntries(FACE_KEYS.map(k => [k, FACES.happy[k]])) as Record<FaceKey, number>
    const base = { lean: 0, level: 0, sleep: 0, breath: 0 }
    const bars = new Float32Array(MOUTH_BARS)
    const aim = { x: 0, y: 0 }
    let settled = false
    let breathTick = 0

    const ctl: ClayControl = {
      look: 1, yaw: 0, pitch: 0, roll: 0, lift: 0, squash: 0,
      armL: { raise: 0, swing: 0, ext: 0 }, armR: { raise: 0, swing: 0, ext: 0 }, baseL: 1, baseR: 1,
      eyeOpen: 1, joy: 0, eyeX: 0, eyeY: 0, eyeTilt: 0, eyeScaleL: 1, eyeScaleR: 1, blinkInterval: 1,
      glow: face.glow, eyeColor, mouth: bars, mouthOn: 0, travel: 0, turn: 0, lean: 0, aim: null,
      update(dt) {
        const { pose: p, expression: e, mouth: source, calm: still, locomotion: loco, asleep: dozing } = live.current
        const g = controller.update(dt)
        const target = FACES[e]
        let moved = 0

        // The face, eased value by value so a change of mood never snaps (the robot's blinks multiply on top).
        for (const k of FACE_KEYS) { const was = face[k]; face[k] = damp(was, target[k], FACE_SPEED[k], dt); moved += Math.abs(face[k] - was) }
        const rgb = target.color ? hexToRGB(target.color) : defaultEyes
        for (let i = 0; i < 3; i++) { const was = eyeColor[i]; eyeColor[i] = damp(was, rgb[i], 6, dt); moved += Math.abs(eyeColor[i] - was) }
        const lean = damp(base.lean, p === 'listening' ? 0.08 : 0, 6, dt)
        moved += Math.abs(lean - base.lean)
        base.lean = lean

        // Mouth: the analyzer's bars while talking (already gated and smoothed); otherwise they ease shut.
        const read = p === 'talking' ? source?.() ?? null : null
        let sum = 0
        for (let i = 0; i < MOUTH_BARS; i++) {
          const was = bars[i]
          bars[i] = read ? read[i] : damp(was, 0, 12, dt)
          if (!read && bars[i] < 1e-3) bars[i] = 0
          moved += Math.abs(bars[i] - was)
          sum += bars[i]
        }
        base.level = sum / MOUTH_BARS
        const mouthOn = damp(ctl.mouthOn, p === 'talking' ? 1 : 0, 8, dt)
        moved += Math.abs(mouthOn - ctl.mouthOn)
        ctl.mouthOn = mouthOn

        // Sleep: eases in and out over a second or two; breathing only without reduced motion.
        const sleep = damp(base.sleep, dozing ? 1 : 0, 1.2, dt)
        moved += Math.abs(sleep - base.sleep)
        base.sleep = sleep < 1e-3 && !dozing ? 0 : sleep
        base.breath = (base.breath + dt * Math.PI * 2 * SLEEP_BREATH_HZ) % (Math.PI * 2)
        const breath = still ? 0 : base.sleep * (0.5 - 0.5 * Math.cos(base.breath))

        // Walking: the stage moves the frame; the legs match its speed, the body turns its way and leans into it.
        const heading = loco && !loco.hidden ? loco.heading : 0
        ctl.travel = loco && !still ? loco.v : 0
        ctl.turn = heading * BODY_TURN
        ctl.lean = loco ? LEAN * Math.sign(loco.v) * loco.speed : 0
        const walking = Math.abs(heading)
        moved += Math.abs(ctl.travel) + walking
        if (loco?.gaze) { aim.x = loco.gaze.x; aim.y = loco.gaze.y; ctl.aim = aim } else ctl.aim = null

        // Head: the cursor (less while a gesture plays or walking; none with reduced motion or asleep), the lean, the
        // face's pose, the gesture, the lead into a walk, the sleepy bow. Clay's +pitch looks up and our +rx dips the
        // face, hence the minus.
        ctl.look = still ? 0 : g.look * (1 - 0.75 * walking) * (1 - base.sleep)
        ctl.pitch = -(base.lean + face.pitch + g.head.rx + SLEEP_BOW * base.sleep + 0.03 * breath)
        ctl.yaw = g.head.ry + HEAD_LEAD * heading
        ctl.roll = -(face.roll + g.head.rz)
        ctl.lift = g.head.lift + 0.05 * breath
        // Body motion from the voice is off with reduced motion; the mouth keeps moving either way.
        ctl.squash = still ? 0 : base.level * 0.05 - 0.03 * breath
        ctl.armL.raise = g.handL.raise; ctl.armL.swing = g.handL.swing; ctl.armL.ext = g.handL.ext
        ctl.armR.raise = g.handR.raise; ctl.armR.swing = g.handR.swing; ctl.armR.ext = g.handR.ext
        ctl.baseL = g.baseL
        ctl.baseR = g.baseR
        ctl.eyeOpen = face.open
        ctl.joy = Math.max(face.joy, g.face.joy)
        ctl.eyeX = face.lookX + g.face.lookX
        ctl.eyeY = face.lookY + g.face.lookY
        ctl.eyeTilt = face.tilt
        ctl.eyeScaleL = face.scaleL
        ctl.eyeScaleR = face.scaleR
        ctl.blinkInterval = face.blink
        ctl.glow = face.glow + base.level * 0.6

        // Keep the robot drawing while anything here moves; let it rest once everything has settled. Breathing alone is
        // slow: a third of the frames is plenty, and saves the GPU while Otto sleeps.
        const moving = controller.busy() || read !== null || moved > 1e-4
        if (moving) { settled = false; return true }
        if (breath > 0 || (base.sleep > 0 && !still)) { settled = false; return ++breathTick % 3 === 0 }
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
        blink={!asleep}
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
