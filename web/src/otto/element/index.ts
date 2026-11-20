// The otto-mascot package: <otto-mascot> and createOtto() for any page, and the pieces they are built from.
// Importing it defines <otto-mascot> (once, however many times it is imported).
import { defineOttoMascot } from './element'

export { OttoMascotElement, defineOttoMascot } from './element'
export { createOtto } from './createOtto'
export type { OttoController, OttoEventMap, OttoState, CreateOttoOptions, SpeakOptions } from './createOtto'
export { defineOttoConfig, deepMerge, THEMES, THEME_NAMES, DEFAULT_OTTO_CONFIG } from '../config'
export type { OttoConfig, ThemeName, DeepPartial } from '../config'
export { createOttoEvents, OTTO_EVENT_TYPES } from '../awareness/events'
export type { OttoEvent, OttoEventType, Importance, OttoEvents, TaskHandle } from '../awareness/events'
export type { Reaction, ReactionRule, ReactionSize, Awareness } from '../awareness/reactions'
export { GESTURE_NAMES } from '../robot/gestures'
export type { GestureName } from '../robot/gestures'
export { SOUND_CUES } from '../sound'
export type { SoundCue } from '../sound'
export type { RobotExpression } from '../robot/robot'
export type { StagePlace, Rect } from '../movement/stage'
// Interactive guidance: tell Otto what to show; he decides how.
export { createOttoGuide, planGuide, MISSING_SAY } from '../guidance/guide'
export type { OttoGuide, GuideRequest, GuideEvent, GuideCommand, GuidePlan, GuideStep, GuideSize, GuideMode, GuideReason, GuideSettings, GuideSituation, GuideTargetInfo, GuideTaskHandle } from '../guidance/guide'
export type { GuideTaskSpec, GuideTaskStep, GuideTaskEvent, GuideTaskStatus } from '../guidance/task'
export { registerGuideTarget, findGuideTarget, listGuideTargets, onGuideTargetsChange } from '../guidance/targets'
export { attachGuide, type GuideRunnerDeps } from '../guidance/runner'

defineOttoMascot()
