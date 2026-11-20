// The active mascot config for React code: OttoConfigProvider sets it, useOttoConfig() reads it. The config itself is
// config.ts (pure, no React).

import { createContext, createElement, useContext, type ReactNode } from 'react'
import { DEFAULT_OTTO_CONFIG, type OttoConfig } from './config'

const ConfigContext = createContext<OttoConfig>(DEFAULT_OTTO_CONFIG)

/** The active mascot config (the nearest OttoConfigProvider's, or the defaults). */
export function useOttoConfig(): OttoConfig {
  return useContext(ConfigContext)
}

export function OttoConfigProvider({ config, children }: { config: OttoConfig; children?: ReactNode }) {
  return createElement(ConfigContext.Provider, { value: config }, children)
}
