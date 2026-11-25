import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { Overlay } from './Overlay'

// The overlay window loads the same page with #overlay.
const isOverlay = window.location.hash === '#overlay'
if (isOverlay) document.documentElement.classList.add('overlay')

createRoot(document.getElementById('root')!).render(<StrictMode>{isOverlay ? <Overlay /> : <App />}</StrictMode>)
