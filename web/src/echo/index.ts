// Echo's public parts. Most apps only need <Echo /> and useAssistantContext.
export { default as Echo } from './Echo'
export { useAssistantContext, publishContext } from './context'
export type { AssistantAction } from './messages'
// Lower-level pieces, for building your own panel or dock.
export { default as EchoRobot } from './robot/EchoRobot'
export { default as VoiceAssistant } from './VoiceAssistant'
export { useVoiceAssistant, type AssistantStatus } from './useVoiceAssistant'
