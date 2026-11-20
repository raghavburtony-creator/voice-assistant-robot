'use client'
// otto-mascot/react: <OttoMascot /> and useOtto() over the <otto-mascot> element. Server rendering outputs a plain
// <otto-mascot> tag; the element itself loads in the browser after mount. Only runtime dependency: react.
//
//   // app/components/Mascot.tsx (Next.js App Router; this module is already 'use client')
//   import { OttoMascot, useOtto } from 'otto-mascot/react'
//   export function Mascot() {
//     const { ref, otto, ready } = useOtto()
//     return <>
//       <OttoMascot ref={ref} theme="midnight" soundEnabled={false} hotkey={null}
//         onActivate={() => otto.playGesture('welcomeWave')} onError={(e) => console.warn(e.message)} />
//       <button disabled={!ready} onClick={() => otto.speakText('Hello!')}>Say hi</button>
//     </>
//   }
//
// Props: state, face, theme, soundEnabled, movementEnabled, hotkey (null: none), placement (read once), config (memoize
// it), className, style, and on<Event> callbacks receiving each event's detail. Undefined props are not rendered.

export { OttoMascot, useOtto, type OttoMascotProps } from './OttoMascot'
export type { OttoMascotHandle, OttoCallbacks, OttoAttributeProps } from './bridge'
