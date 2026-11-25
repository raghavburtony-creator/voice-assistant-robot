import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './app.css'
import './tailwind.css'
import { isDesktopRuntime } from './otto/desktop'

if (isDesktopRuntime()) document.documentElement.dataset.desktop = 'true'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
