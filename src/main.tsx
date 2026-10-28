import { createRoot } from 'react-dom/client'
import App from './App'
import { setPortalRoot } from './store'
import './styles.css'
import './components/components.css'

// Which build is running, readable without digging into the bundle:
//   document.documentElement.dataset.forge3dBuild   // "harness" | "web"
// The two builds differ in what they contain rather than in how they look, so
// this is the fastest way to tell a stale tab from a wrong build.
document.documentElement.dataset.forge3dBuild = __FORGE3D_EMBED__ ? 'harness' : 'web'

const root = document.getElementById('app')!
setPortalRoot(root)
createRoot(root).render(<App />)
