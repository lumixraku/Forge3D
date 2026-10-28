import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
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
declare const __FORGE3D_CSS_SAFE__: string | undefined
const STYLE_ID = 'forge3d-plugin-style'

/**
 * Height the harness's floating composer occupies at the bottom of the view.
 * `maxHeight` is the other half of the same idea: the view container can be
 * taller than the window, and without a viewport-relative cap the app's own
 * bottom toolbar ends up below the visible area.
 * The app is placed against the view's edges and leaves this strip alone, so its
 * own bottom toolbar stays reachable. Kept as CSS only: measuring the container
 * here fed the app's height back into the container and scrolled the view.
 */
// The shell's composer is not reachable from the plugin's JS (it is not in the
// DOM tree this code can query), so its height cannot be measured. This strip is
// sized for the composer at one to three lines; below that it costs a little
// empty space, above it the canvas would start to be covered again.
const HARNESS_BOTTOM_INSET = '168px'

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  // Undefined in a dev server (the build writes it); the app still runs, just
  // without the plugin's scoped copy of the stylesheet.
  style.textContent = typeof __FORGE3D_CSS__ === 'string' ? __FORGE3D_CSS__ : ''
  document.head.append(style)
}

export function ForgeCanvasView() {
  // The app reads its container (theme, overlays, keyboard focus) while it is
  // being set up, so it renders only once the container exists — and the
  // container must already have its final height. If it is mounted before the
  // harness has laid out the view, the app lays out against a zero-height box
  // and only corrects itself on the next window resize.
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [inset, setInset] = useState(0)

  const attach = useCallback((element: HTMLDivElement | null) => {
    setRoot(element)
  }, [])

  if (root) setPortalRoot(root)
  useEffect(() => () => setPortalRoot(null), [])

  // Placement is CSS (absolutely pinned inside the view). The height cap is JS,
  // for two things CSS cannot see: the view container may be taller than the
  // window, and the harness's composer grows as it is typed into.
  useLayoutEffect(() => {
    const element = root
    if (!element) return

    // The composer lives in a shadow root in this shell, so a plain
    // `querySelector` finds nothing and silently reads as "reserve nothing".
    const findComposer = () => {
      const found: HTMLElement[] = []
      const walk = (scope: ParentNode) => {
        scope.querySelectorAll<HTMLElement>('textarea, input, [contenteditable="true"]').forEach((el) => {
          if (!element.contains(el)) found.push(el)
        })
        scope.querySelectorAll<HTMLElement>('*').forEach((el) => {
          if (el.shadowRoot) walk(el.shadowRoot)
        })
      }
      walk(document)
      return found.find((el) => /message/i.test(el.getAttribute('placeholder') ?? '')) ?? null
    }

    // Fallback: find the floating composer by geometry. The shell's composer is
    // not reachable through the shadow-free DOM, but it is always the widest box
    // pinned to the bottom of the window.
    const composerByGeometry = () => {
      let best: HTMLElement | null = null
      let bestTop = Infinity
      const viewport = window.innerHeight
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
        if (element.contains(el)) continue
        const rect = el.getBoundingClientRect()
        if (rect.height < 40 || rect.height > 260) continue
        if (rect.width < window.innerWidth * 0.3) continue
        if (viewport - rect.bottom > 24) continue
        if (rect.top < viewport * 0.5) continue
        if (rect.top < bestTop) {
          bestTop = rect.top
          best = el
        }
      }
      return best
    }

    const composerBox = () => {
      const composer = findComposer()
      if (composer) return composer.closest('form') ?? composer.parentElement
      return composerByGeometry()
    }

    // The shell already shrinks the view slot when its composer grows (measured:
    // slot 653 vs viewport area 782). So the app fills the slot and no strip has
    // to be reserved — the height only has to be capped to the slot itself.
    const cap = () => {
      const slot = element.parentElement?.parentElement ?? null
      const top = Math.max(0, element.getBoundingClientRect().top)
      const slotHeight = slot?.clientHeight && slot.clientHeight > 200 ? slot.clientHeight : window.innerHeight - top
      setInset(0)
      element.style.maxHeight = `${Math.round(slotHeight)}px`
      element.style.bottom = '0px'
    }

    cap()
    requestAnimationFrame(cap)
    window.addEventListener('resize', cap)
    const observer = new ResizeObserver(cap)
    observer.observe(document.body)
    // Follow the composer itself, so typing that makes it taller shrinks the app.
    let watched: HTMLElement | null = null
    const watch = () => {
      const box = composerBox()
      if (!box || box === watched) return
      if (watched) observer.unobserve(watched)
      watched = box
      observer.observe(box)
      cap()
    }
    watch()
    const timer = window.setInterval(watch, 1000)
    return () => {
      window.removeEventListener('resize', cap)
      window.clearInterval(timer)
      observer.disconnect()
    }
  }, [root])

  // Temporary: report the box chain at several moments after mount.
  useEffect(() => {
    const element = root
    if (!element) return
    const probe = (tag: string) => {
      const chain: any[] = []
      let el: HTMLElement | null = element
      for (let i = 0; i < 6 && el; i += 1) {
        const r = el.getBoundingClientRect()
        const st = getComputedStyle(el)
        chain.push({ i, tag: el.tagName.toLowerCase(), h: Math.round(r.height), top: Math.round(r.top), cssH: st.height, ov: st.overflow, padB: st.paddingBottom })
        el = el.parentElement
      }
      const candidates = [...document.querySelectorAll<HTMLElement>('textarea, input, [contenteditable], [role="textbox"]')]
        .slice(0, 14)
        .map((el) => {
          const r = el.getBoundingClientRect()
          const st = getComputedStyle(el)
          return {
            tag: el.tagName.toLowerCase(),
            ph: el.getAttribute('placeholder'),
            aria: el.getAttribute('aria-label'),
            inside: element.contains(el),
            top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
            pos: st.position,
          }
        })
      fetch('/forge3d/api/_debug/layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tag, innerHeight: window.innerHeight, chain, candidates }) }).catch(() => {})
    }
    const timers = [120, 700, 1800].map((ms) => window.setTimeout(() => probe(`t${ms}`), ms))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [root])

  ensureStyle()
  return (
    <div ref={attach} className="forge3d-root" data-inset={inset} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, boxSizing: 'border-box', minHeight: 0, overflow: 'hidden' }}>
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
