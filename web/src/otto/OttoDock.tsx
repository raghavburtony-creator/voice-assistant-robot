// Otto, docked along the bottom of the page (at the config's movement.home: bottom right by default). A click on the robot (or
// the dock's button, from the keyboard) opens the voice guide. When the guide opens Otto turns and walks aside to stand
// beside it, and walks back home when it closes; there he mouths what he says, and the bubble keeps pace with his voice.

import type { SpeechClock } from './audio'
import type { OttoEvents } from './awareness/events'
import { useOttoConfig } from './useOttoConfig'
import type { MouthSource } from './mouth'
import type { StageController } from './movement/stage'
import OttoStage, { type IdleControls } from './OttoStage'
import type { GestureChannel } from './robot/gestures'
import type { RobotExpression, RobotPose } from './robot/robot'
import { Button } from './ui'
import type { AssistantStatus } from './useVoiceAssistant'

type Props = {
  status: AssistantStatus
  /** The voice panel is open: Otto keeps clear of it, and the button goes (the panel has its own controls). */
  voiceOpen: boolean
  /** What Otto is saying now (empty when quiet). */
  line: string
  mouth: MouthSource
  speech?: SpeechClock
  onTalk: () => void
  gestures: GestureChannel
  stage: StageController
  events?: OttoEvents
  idleControls?: { current: IdleControls | null }
}

/** How each voice status looks on the robot (the lab reuses these). */
export const poseFor = (status: AssistantStatus): RobotPose =>
  status === 'speaking' ? 'talking' : status === 'listening' ? 'listening' : status === 'connecting' ? 'thinking' : 'idle'

export const expressionFor = (status: AssistantStatus): RobotExpression =>
  status === 'error' ? 'alert' : status === 'connecting' ? 'searching' : status === 'speaking' ? 'excited' : 'happy'

/** The voice panel, which Otto steps aside for. */
const PANEL: readonly string[] = ['.voice-assistant']

export default function OttoDock({ status, voiceOpen, line, mouth, speech, onTalk, gestures, stage, events, idleControls }: Props) {
  const { name } = useOttoConfig()
  const session = status === 'connecting' || status === 'listening' || status === 'speaking'
  return (
    <OttoStage className="otto-dock" stage={stage} pose={poseFor(status)} expression={expressionFor(status)}
      say={voiceOpen ? line : ''} mouth={mouth} speech={speech} gestures={gestures} events={events} onActivate={onTalk}
      busy={voiceOpen || session} conversing={session} obstacles={voiceOpen ? PANEL : undefined} obstaclesKey={voiceOpen} idleControls={idleControls}>
      {!voiceOpen && <Button variant="tonal" className="otto-dock__button" onClick={onTalk}>Talk to {name}</Button>}
    </OttoStage>
  )
}
