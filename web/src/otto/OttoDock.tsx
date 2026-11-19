// Otto, docked bottom right. A click on the robot (or the dock's button, from the keyboard) opens the voice guide. While the guide
// is open the robot steps beside the panel and mouths what Otto says; its chest bars follow the real voice.

import { ASSISTANT_NAME } from '../otto.config'
import OttoRobot from './robot/OttoRobot'
import type { GestureChannel } from './robot/gestures.js'
import type { RobotExpression, RobotPose } from './robot/robot'
import { Button } from './ui'
import type { AssistantStatus } from './useVoiceAssistant'

type Props = {
  status: AssistantStatus
  /** The voice panel is open: the dock steps aside, and the button goes (the panel has its own controls). */
  voiceOpen: boolean
  /** What Otto is saying now (empty when quiet). */
  line: string
  speechBands: (count: number) => number[] | null
  onTalk: () => void
  gestures?: GestureChannel
}

const poseFor = (status: AssistantStatus): RobotPose =>
  status === 'speaking' ? 'talking' : status === 'listening' ? 'listening' : status === 'connecting' ? 'thinking' : 'idle'

const expressionFor = (status: AssistantStatus): RobotExpression =>
  status === 'error' ? 'alert' : status === 'connecting' ? 'searching' : status === 'speaking' ? 'excited' : 'happy'

export default function OttoDock({ status, voiceOpen, line, speechBands, onTalk, gestures }: Props) {
  return (
    <div className={voiceOpen ? 'otto-dock otto-dock--beside-voice' : 'otto-dock'}>
      <OttoRobot className="otto-dock__robot" pose={poseFor(status)} expression={expressionFor(status)}
        say={voiceOpen ? line : ''} speechBands={speechBands} gestures={gestures} onActivate={onTalk} />
      {!voiceOpen && <Button variant="tonal" className="otto-dock__button" onClick={onTalk}>Talk to {ASSISTANT_NAME}</Button>}
    </div>
  )
}
