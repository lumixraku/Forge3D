// Local reproduction of the harness slot: mounts the plugin view inside a
// flex-sized panel with the composer floating over the bottom, so the layout
// can be screenshotted without touching DSH.
import { createRoot } from 'react-dom/client'
import { ForgeCanvasView } from './plugin'

const view = document.getElementById('view')!
createRoot(view).render(<ForgeCanvasView />)
