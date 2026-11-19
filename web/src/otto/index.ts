// Otto's public parts. Most apps only need <Otto /> and useAssistantContext.
export { default as Otto } from './Otto'
export { useAssistantContext, publishContext } from './context'
export type { AssistantAction } from './messages'
// Lower-level pieces, for building your own panel or dock.
export { default as OttoRobot } from './robot/OttoRobot'
export { default as VoiceAssistant } from './VoiceAssistant'
export { useVoiceAssistant, type AssistantStatus } from './useVoiceAssistant'
export { createGestureChannel, GESTURE_NAMES, isGestureName } from './robot/gestures.js'
export type { GestureName, GestureChannel, GestureOptions } from './robot/gestures.js'
