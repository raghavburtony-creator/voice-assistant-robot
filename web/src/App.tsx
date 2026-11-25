// A small demo of the kit: three pages, Otto docked in the corner, and the two example commands.
// Replace this file with your own app; keep <Otto /> and the onAction handler.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isPage, PAGES, SHORTCUT_LABEL, type PageId } from './otto.config'
import { Otto, createOttoEvents, createOttoGuide, registerGuideTask, useAssistantContext, type AssistantAction, type GuideTaskHandle } from './otto'
import { executeDesktopAction } from './otto/desktop'

function pageFromHash(): PageId {
  const id = window.location.hash.slice(1)
  return PAGES.find(page => page.id === id)?.id ?? 'home'
}

export default function App() {
  const [page, setPage] = useState<PageId>(pageFromHash)
  const [message, setMessage] = useState('')
  const [dark, setDark] = useState(false)
  const guide = useMemo(createOttoGuide, [])
  const events = useMemo(createOttoEvents, [])
  // A task Otto can walk you through, and see you do: he notices each step himself (no "next" button). The voice can
  // start it too ("how do I show a message?"), because it is offered here.
  useEffect(() => registerGuideTask({
    id: 'show-message', title: 'Show an example message',
    intro: "Sure, it takes two steps.", doneSay: 'There it is!',
    steps: [
      { id: 'open', target: 'nav', say: 'First, open Features in the Pages menu.', doneWhen: [{ on: 'event', type: 'section', topic: 'features' }] },
      { id: 'press', target: 'show-message', say: 'Now press Show a message.', doneWhen: [{ on: 'event', type: 'success', topic: 'message' }] },
    ],
    // Going back to Home abandons it.
    cancelWhen: [{ on: 'event', type: 'section', topic: 'home' }],
  }), [])
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  useEffect(() => { document.title = `${PAGES.find(item => item.id === page)?.title} · Otto voice kit` }, [page])

  const goTo = (next: PageId) => { window.location.hash = next }

  // Otto's actions arrive here, already checked against otto.config.ts. Handle each kind your server's tools can send.
  const onAction = useCallback((action: AssistantAction) => {
    if (action.action === 'navigate') {
      if (isPage(action.page)) goTo(action.page)
      return
    }
    if (action.action === 'desktop_action') {
      const labels = {
        minimize_otto: 'minimize Otto',
        restore_otto: 'restore Otto',
        move_home: 'move Otto to the centre of the desktop',
        move_left: 'move Otto to the left side of the desktop',
        move_right: 'move Otto to the right side of the desktop',
        move_top: 'move Otto to the top of the desktop',
        move_bottom: 'move Otto to the bottom of the desktop',
        launch_calculator: 'launch Calculator',
        launch_text_editor: 'launch Text Editor',
      } as const
      const description = labels[action.desktop_action]
      const desktopTask = events.task(`desktop-action-${Date.now()}`, {
        importance: 'normal',
        topic: 'desktop-action',
        message: `Otto is requesting permission to ${description}.`,
        data: { action: action.desktop_action },
      })
      if (!window.confirm(`Allow Otto to ${description}?\n\nThis action will run only if you approve it.`)) {
        desktopTask.fail('The visitor declined this desktop action. Nothing was executed.')
        return
      }

      void executeDesktopAction(action.desktop_action).then(result => {
        if (result.ok) desktopTask.succeed(`${result.message} Verification: ${result.verification}.`)
        else desktopTask.fail(`${result.message} Verification: ${result.verification}.`)
      }).catch(() => desktopTask.fail(`Otto could not ${description}.`))
      return
    }
    // Otto shows it, walks you through it, or puts the card in his panel, himself.
    else if (action.action === 'guide' || action.action === 'task' || action.action === 'task_move' || action.action === 'card') return
    else if (action.name === 'show_message') setMessage(`Hello from Otto, at ${new Date().toLocaleTimeString()}.`)
    else if (action.name === 'toggle_theme') setDark(value => !value)
  }, [events])

  // Tell Otto when a message appears (by the button or by his own command); he reacts, and a guided task can see it.
  useEffect(() => { if (message) events.notify({ type: 'success', topic: 'message', where: '.app-message' }) }, [message, events])

  // What Otto can read with get_screen_context. The third argument names an event in app_config.py EVENTS: Otto reacts to it once.
  useAssistantContext('demo', { theme: dark ? 'dark' : 'light', message: message || null }, message ? 'message_shown' : undefined)

  // The tour: keep its handle, show where the visitor is in it, and let them step, go back or stop.
  const [tour, setTour] = useState<{ handle: GuideTaskHandle; index: number; total: number } | null>(null)
  const startTour = () => {
    const handle = guide.startTask({
      id: 'tour', title: 'Show me around',
      steps: [
        { id: 'nav', target: 'nav', say: 'The Pages menu at the top switches between Home, Features and About.' },
        { id: 'title', target: 'page-title', say: 'The page heading shows which page you are on.' },
        { id: 'around', target: 'around', say: 'The Show me around button starts this tour again.' },
      ],
    })
    setTour({ handle, index: 0, total: 3 })
  }
  const around = useRef<HTMLButtonElement>(null)
  useEffect(() => guide.onEvent(event => {
    if (event.type === 'step') setTour(t => (t ? { ...t, index: event.index, total: event.total } : t))
    else if (event.type === 'done' || event.type === 'cancelled') {
      // The focused tour button is about to unmount: hand focus to the button that starts the tour.
      if (document.activeElement?.closest('[aria-label="Tour"]')) setTimeout(() => around.current?.focus(), 0)
      setTour(null)
    }
  }), [guide])
  useEffect(() => {
    if (!tour) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) guide.stop() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tour, guide])

  return <>
    <header className="app-header">
      <strong>Otto voice kit</strong>
      <nav aria-label="Pages" data-otto-target="nav" data-otto-label="the Pages menu" data-otto-description="Switches between Home, Features and About.">
        {PAGES.map(item => <a key={item.id} href={`#${item.id}`} aria-current={item.id === page ? 'page' : undefined}>{item.title}</a>)}
      </nav>
    </header>
    <main className="app-main">
      <button ref={around} type="button" className="otto-btn otto-btn--text" data-otto-target="around" data-otto-label="the Show me around button" data-otto-description="Starts a short tour of this page." onClick={startTour}>Show me around</button>
      {tour && <p role="group" aria-label="Tour">Step {tour.index + 1} of {tour.total}{' '}
        <button type="button" className="otto-btn otto-btn--tonal" aria-disabled={tour.index === 0} onClick={() => { if (tour.index > 0) tour.handle.back() }}>Back</button>{' '}
        <button type="button" className="otto-btn otto-btn--filled" onClick={() => tour.handle.complete()}>{tour.index + 1 === tour.total ? 'Finish' : 'Next'}</button>{' '}
        <button type="button" className="otto-btn otto-btn--text" onClick={() => guide.stop()}>Stop tour</button></p>}
      <h1 ref={heading} tabIndex={-1} data-otto-target="page-title" data-otto-label="the page heading" data-otto-description="The name of the page you are on.">{PAGES.find(item => item.id === page)?.title}</h1>
      {page === 'home' && <>
        <p>This is a demo of Otto, a robot voice guide built on Gemini Live. Click the robot, {SHORTCUT_LABEL ? `or press ${SHORTCUT_LABEL}, ` : ''}and ask it something.</p>
        <p>Try: “What can this app do?”, “Take me to About”, “Show me a message”, or “Switch to dark mode”.</p>
      </>}
      {page === 'features' && <>
        <ul>
          <li>Talk to Otto, or type to it.</li>
          <li>Otto can open pages and run the app's commands, and every action can be checked and undone.</li>
          <li>Say “Hey Otto” to start hands-free (turn it on in the voice panel).</li>
        </ul>
        <button type="button" className="otto-btn otto-btn--tonal" data-otto-target="show-message" data-otto-label="the Show a message button" data-otto-description="Shows an example message on the page." onClick={() => setMessage(`You pressed the button at ${new Date().toLocaleTimeString()}.`)}>
          Show a message
        </button>
      </>}
      {page === 'about' && <p>While the voice guide is open, your voice and what you type are sent to Google's Gemini to answer you. This app saves none of it.</p>}
      {message && <p className="app-message" role="status">{message}</p>}
    </main>
    <Otto page={page} onAction={onAction} guide={guide} events={events} />
  </>
}
