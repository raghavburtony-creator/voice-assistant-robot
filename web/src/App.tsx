// A small demo of the kit: three pages, Echo docked in the corner, and the two example commands.
// Replace this file with your own app; keep <Echo /> and the onAction handler.

import { useCallback, useEffect, useRef, useState } from 'react'
import { PAGES, type PageId } from './echo.config'
import { Echo, useAssistantContext, type AssistantAction } from './echo'

function pageFromHash(): PageId {
  const id = window.location.hash.slice(1)
  return PAGES.find(page => page.id === id)?.id ?? 'home'
}

export default function App() {
  const [page, setPage] = useState<PageId>(pageFromHash)
  const [message, setMessage] = useState('')
  const [dark, setDark] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  useEffect(() => { document.title = `${PAGES.find(item => item.id === page)?.title} · Echo voice kit` }, [page])

  const goTo = (next: PageId) => { window.location.hash = next }

  // Echo's actions arrive here, already checked against echo.config.ts. Handle each kind your server's tools can send.
  const onAction = useCallback((action: AssistantAction) => {
    if (action.action === 'navigate') goTo(action.page)
    else if (action.name === 'show_message') setMessage(`Hello from Echo, at ${new Date().toLocaleTimeString()}.`)
    else if (action.name === 'toggle_theme') setDark(value => !value)
  }, [])

  // What Echo can read with get_screen_context. The third argument names an event in app_config.py EVENTS: Echo reacts to it once.
  useAssistantContext('demo', { theme: dark ? 'dark' : 'light', message: message || null }, message ? 'message_shown' : undefined)

  return <>
    <header className="app-header">
      <strong>Echo voice kit</strong>
      <nav aria-label="Pages">
        {PAGES.map(item => <a key={item.id} href={`#${item.id}`} aria-current={item.id === page ? 'page' : undefined}>{item.title}</a>)}
      </nav>
    </header>
    <main className="app-main">
      <h1 ref={heading} tabIndex={-1}>{PAGES.find(item => item.id === page)?.title}</h1>
      {page === 'home' && <>
        <p>This is a demo of Echo, a robot voice guide built on Gemini Live. Click the robot, or press Alt+E, and ask it something.</p>
        <p>Try: “What can this app do?”, “Take me to About”, “Show me a message”, or “Switch to dark mode”.</p>
      </>}
      {page === 'features' && <>
        <ul>
          <li>Talk to Echo, or type to it.</li>
          <li>Echo can open pages and run the app's commands, and every action can be checked and undone.</li>
          <li>Say “Hey Echo” to start hands-free (turn it on in the voice panel).</li>
        </ul>
        <button type="button" className="echo-btn echo-btn--tonal" onClick={() => setMessage(`You pressed the button at ${new Date().toLocaleTimeString()}.`)}>
          Show a message
        </button>
      </>}
      {page === 'about' && <p>While the voice guide is open, your voice and what you type are sent to Google's Gemini to answer you. This app saves none of it.</p>}
      {message && <p className="app-message" role="status">{message}</p>}
    </main>
    <Echo page={page} onAction={onAction} />
  </>
}
