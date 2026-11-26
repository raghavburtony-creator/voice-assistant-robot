// Which SignRecognizer, if any, this app plugs in (D-29). The kit ships none, so by default there is no sign input at all.
// The provider is for an app (or the lab) that has its own adapter; it is not exported from any package entry point.

import { createContext, createElement, useContext, type ReactNode } from 'react'
import type { SignRecognizer } from './sign'

const RecognizerContext = createContext<SignRecognizer | null>(null)

/** The configured recognizer, or null (the default: the panel shows no sign input). */
export function useSignRecognizer(): SignRecognizer | null {
  return useContext(RecognizerContext)
}

export function SignRecognizerProvider({ recognizer, children }: { recognizer: SignRecognizer | null; children?: ReactNode }) {
  return createElement(RecognizerContext.Provider, { value: recognizer }, children)
}
