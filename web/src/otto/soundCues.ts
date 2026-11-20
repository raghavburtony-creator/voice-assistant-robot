// The names of Otto's sound cues. Pure data, so config.ts can name them without loading the Web Audio code (sound.ts).

export const SOUND_CUES = ['chirpConnect', 'chirpAcknowledge', 'chirpThinking', 'chirpNegative', 'chirpCelebration', 'chirpGoodbye'] as const
export type SoundCue = (typeof SOUND_CUES)[number]
