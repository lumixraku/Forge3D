import { useEffect, useState } from 'react'
import App from './App'
import { setPortalRoot } from './store'
import './styles.css'
import './components/components.css'

/**
 * DSH plugin client entry: the canvas as a native `conversation.view` tab.
 *
 * Built by `vite.config.plugin.ts` into `dsh-plugin/lib/client.js`, wrapped in
 * `window.__ModuleLoader__.load(...)`. React comes from the harness shell, so
 * this component renders inside the harness's own React tree.
 */

// The app's CSS, scoped to `.forge3d-root` at build time and prepended by the
// bundle wrapper. Inserted once, the first time a tab mounts.
declare const __FORGE3D_CSS__: string
const STYLE_ID = 'forge3d-plugin-style'

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = __FORGE3D_CSS__
  document.head.append(style)
}

export function ForgeCanvasView() {
  // The app reads its container (theme, overlays, keyboard focus) while it is
  // being set up, so it renders only once the container exists.
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  if (root) setPortalRoot(root)
  useEffect(() => () => setPortalRoot(null), [])
  ensureStyle()
  return (
    <div ref={setRoot} className="forge3d-root" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {root ? <App /> : null}
    </div>
  )
}

/** Cordis entry: one `conversation.view` tab. */
export function apply(ctx: any) {
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    { name: 'conversation.view', id: 'forge3d', order: 20, label: () => 'Canvas' },
    ForgeCanvasView,
  ))
}

export const inject = ['slots']
