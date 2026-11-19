// The main page: Originkit's Clay Robot (src/components/originkit/ui/clay-robot.tsx, added with `npx originkit add clay-robot`),
// centred full-screen on a dark background. The earlier Otto demo page is in git history (commit ed26aeb).
import ClayRobot from './components/originkit/ui/clay-robot'

export default function App() {
  return (
    <main className="flex h-dvh w-screen items-center justify-center overflow-hidden bg-neutral-950 p-4">
      <div className="aspect-[4/3] w-full max-w-[min(100%,calc((100dvh-2rem)*4/3))]">
        <ClayRobot />
      </div>
    </main>
  )
}
