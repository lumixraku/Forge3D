import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'

/**
 * The app's state layer: plain mutable state that React re-renders from.
 *
 * The canvas logic lives in long-lived controllers (`src/state/*`) that read and
 * assign `.value` and mutate nested objects in place — a message bubble flips
 * `pending`, a node gets a new `data`. Rather than threading every one of those
 * writes through `setState`, state objects are wrapped in a Proxy: any write
 * bumps one global version, and every mounted component re-renders from that
 * version through `useSyncExternalStore`.
 *
 * One version for the whole app is deliberate. The app is a single editor
 * screen whose components all hang off one root, so "something changed, render
 * again" is the right granularity, and it keeps this file small.
 */

let version = 0
let renderedVersion = 0
let flushQueued = false
let setupDepth = 0
let notifyQueued = false
const listeners = new Set<() => void>()
const tickResolvers: Array<() => void> = []

type Source<T> = { value: T } | (() => T)
interface Watcher { get: () => unknown; cb: (next: any, previous: any) => void; last: unknown; sync: boolean; deep: boolean; active: boolean }
const watchers = new Set<Watcher>()
let runningSync = false
let rerunSync = false

interface Instance { mounted: Array<() => void>; unmounted: Array<() => void>; stops: Array<() => void> }
let currentInstance: Instance | null = null

function notify() {
  notifyQueued = false
  for (const listener of [...listeners]) listener()
}

function trigger() {
  version += 1
  runSyncWatchers()
  // React is told straight away, so a write inside an event handler renders
  // before React restores a controlled input. A write made while a component is
  // being set up (that is, during render) is told after the render instead.
  if (setupDepth > 0) {
    if (!notifyQueued) {
      notifyQueued = true
      queueMicrotask(notify)
    }
  } else {
    notify()
  }
  queueFlush()
}

function queueFlush() {
  if (flushQueued) return
  flushQueued = true
  queueMicrotask(flush)
}

function flush() {
  flushQueued = false
  runWatchers(false)
  // A watcher that wrote state queued another flush; that one finishes the job.
  if (flushQueued) return
  if (!listeners.size || renderedVersion === version) resolveTicks()
}

function resolveTicks() {
  const pending = tickResolvers.splice(0)
  for (const resolve of pending) resolve()
}

/** Called after every commit: the DOM now reflects `version`. */
let watchedAfterRender = -1

function markRendered() {
  renderedVersion = version
  // Watchers on props see the new props only after the render that passed them.
  // Every component calls this after the same commit; the first call does it.
  if (watchedAfterRender !== version) {
    watchedAfterRender = version
    runWatchers(false)
  }
  if (!flushQueued && renderedVersion === version) resolveTicks()
}

/** Resolves once every pending write has been rendered and committed. */
export function nextTick(fn?: () => unknown): Promise<any> {
  const done = new Promise<void>((resolve) => {
    tickResolvers.push(resolve)
    queueFlush()
  })
  return fn ? done.then(fn) : done
}

export function getVersion() {
  return version
}

// --- deep state ------------------------------------------------------------

const RAW = Symbol('raw')
const proxies = new WeakMap<object, any>()

// Only plain objects and arrays are tracked. A File, a Blob, an editor or any
// class instance keeps its identity: its methods must run on the real object.
function isPlain(value: unknown): value is object {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return true
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function toRaw<T>(value: T): T {
  return (value && typeof value === 'object' && (value as any)[RAW]) || value
}

function track<T>(value: T): T {
  if (!isPlain(value)) return value
  if ((value as any)[RAW]) return value
  const existing = proxies.get(value)
  if (existing) return existing
  const proxy = new Proxy(value as any, {
    get(target, key, receiver) {
      if (key === RAW) return target
      const result = Reflect.get(target, key, receiver)
      return isPlain(result) ? track(result) : result
    },
    set(target, key, next) {
      const raw = toRaw(next)
      const previous = target[key]
      const ok = Reflect.set(target, key, raw)
      if (previous !== raw || (Array.isArray(target) && key === 'length')) trigger()
      return ok
    },
    deleteProperty(target, key) {
      const had = Object.prototype.hasOwnProperty.call(target, key)
      const ok = Reflect.deleteProperty(target, key)
      if (had) trigger()
      return ok
    },
    defineProperty(target, key, descriptor) {
      const ok = Reflect.defineProperty(target, key, descriptor)
      trigger()
      return ok
    },
  })
  proxies.set(value as any, proxy)
  return proxy
}

export interface State<T> { value: T }

const IS_STATE = Symbol('state')

export function isState(value: unknown): value is { value: unknown } {
  return Boolean(value && typeof value === 'object' && (value as any)[IS_STATE])
}

/** A piece of state. Assigning `.value`, or mutating anything inside it, re-renders. */
export function state<T>(initial?: T): State<T> {
  let current = track(initial as T)
  return {
    [IS_STATE]: true,
    get value() { return current },
    set value(next: T) {
      const tracked = track(next)
      if (tracked === current) return
      current = tracked
      trigger()
    },
  }
}

/** A value computed from state, recomputed after any write. */
export function derived<T>(compute: () => T): { readonly value: T } {
  let cachedVersion = -1
  let cached: T
  return {
    [IS_STATE]: true,
    get value() {
      if (cachedVersion !== version) {
        const next = compute()
        // Any write anywhere bumps the version, so most recomputations produce an
        // equal value. Keeping the old reference then is what stops a watcher on
        // this value from firing (and, through its writes, looping) on every write.
        if (cachedVersion === -1 || !sameValue(next, cached)) cached = next
        cachedVersion = version
      }
      return cached
    },
  }
}

// --- watchers --------------------------------------------------------------

function read<T>(source: Source<T>): T {
  return typeof source === 'function' ? source() : source.value
}

function sameValue(a: unknown, b: unknown) {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (!isPlain(a) || !isPlain(b)) return false
  return signature(a) === signature(b)
}

function signature(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return value
  }
}

function differs(next: unknown, previous: unknown) {
  if (Array.isArray(next) && Array.isArray(previous)) {
    return next.length !== previous.length || next.some((item, index) => !Object.is(item, previous[index]))
  }
  return !Object.is(next, previous)
}

function runWatcher(watcher: Watcher) {
  if (!watcher.active) return
  const value = watcher.get()
  // A deep watcher fires on any change inside its value, even when the outer
  // object is the same one: compare a serialized copy instead of identity.
  const next = watcher.deep ? signature(value) : value
  if (!differs(next, watcher.last)) return
  const previous = watcher.last
  watcher.last = next
  watcher.cb(value, previous)
}

function runWatchers(sync: boolean) {
  for (const watcher of [...watchers]) if (watcher.sync === sync) runWatcher(watcher)
}

function runSyncWatchers() {
  if (runningSync) {
    rerunSync = true
    return
  }
  runningSync = true
  try {
    do {
      rerunSync = false
      runWatchers(true)
    } while (rerunSync)
  } finally {
    runningSync = false
  }
}

/**
 * Call `cb` when `source` changes. `flush: 'sync'` runs inside the write that
 * caused it; the default runs once per batch of writes, and again after a render.
 */
export function watch(source: Source<any> | Array<Source<any>>, cb: (next: any, previous: any) => void, options: { immediate?: boolean; flush?: 'pre' | 'post' | 'sync'; deep?: boolean } = {}) {
  const get = Array.isArray(source) ? () => source.map(read) : () => read(source)
  const deep = Boolean(options.deep)
  const initial = get()
  const watcher: Watcher = { get, cb, last: deep ? signature(initial) : initial, sync: options.flush === 'sync', deep, active: true }
  watchers.add(watcher)
  const stop = () => {
    watcher.active = false
    watchers.delete(watcher)
  }
  currentInstance?.stops.push(stop)
  if (options.immediate) cb(initial, undefined)
  return stop
}

// --- lifecycle -------------------------------------------------------------

export function onMounted(fn: () => void) {
  currentInstance?.mounted.push(fn)
}

export function onUnmounted(fn: () => void) {
  currentInstance?.unmounted.push(fn)
}

export const onBeforeUnmount = onUnmounted

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// --- components ------------------------------------------------------------

interface ComponentSpec {
  /** Declared prop names; anything else passed in falls through to the root element. */
  props?: string[]
  /** Declared event names; `emit('update:open', v)` calls the `onUpdateOpen` prop. */
  emits?: string[]
  /** Values used when a prop is passed as `undefined`. */
  defaults?: Record<string, unknown>
}

/** `'update:canvas-view'` → `'onUpdateCanvasView'`: the prop an event is delivered to. */
export function handlerName(event: string) {
  return 'on' + event.split(/[:-]/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('')
}

/**
 * Run `setup` once for the component's lifetime and re-render whenever state
 * changes. `setup` receives a props object that always holds the latest props
 * (so closures made once still read current values), an `emit` that calls the
 * matching `on…` prop, and the undeclared props to pass to the root element.
 */
export function useSetup<P extends Record<string, any>>(
  rawProps: P,
  spec: ComponentSpec,
  setup: (props: any, emit: (event: string, ...args: any[]) => void, attrs: Record<string, any>) => Record<string, any> | void,
): any {
  const [instance] = useState(() => {
    const created: Instance & { bindings: Record<string, any> | null; props: any; attrs: any; vm: any; emit: any } = { mounted: [], unmounted: [], stops: [], bindings: null, props: {}, attrs: {}, vm: null, emit: null }
    // What the markup reads: a binding made by `state`/`derived` reads (and
    // assigns) through `.value`; any other name falls back to the props.
    created.vm = new Proxy({}, {
      get(_target, key) {
        if (key === '$attrs') return created.attrs
        if (key === 'emit') return created.emit
        if (key === '$ref') return (name: string) => bindRef(created.bindings![name])
        const bindings = created.bindings || {}
        if (key in bindings) {
          const binding = bindings[key as string]
          return isState(binding) ? binding.value : binding
        }
        return created.props[key]
      },
      set(_target, key, value) {
        const bindings = created.bindings || {}
        const binding = bindings[key as string]
        if (isState(binding)) binding.value = value
        else bindings[key as string] = value
        return true
      },
    })
    return created
  })
  // Refreshed on every render, before anything reads it, so closures made once
  // during setup always see the current props.
  const declared = new Set(spec.props || [])
  const handlers = new Set((spec.emits || []).map(handlerName))
  for (const key of Object.keys(instance.props)) if (!(key in rawProps)) delete instance.props[key]
  for (const key of Object.keys(instance.attrs)) delete instance.attrs[key]
  for (const [key, value] of Object.entries(rawProps)) {
    if (declared.has(key) || handlers.has(key) || key === 'expose' || key === 'children') instance.props[key] = value
    else instance.attrs[key] = value
  }
  for (const [key, value] of Object.entries(spec.defaults || {})) {
    if (instance.props[key] === undefined) instance.props[key] = value
  }
  if (!instance.bindings) {
    const emit = (event: string, ...args: any[]) => instance.props[handlerName(event)]?.(...args)
    instance.emit = emit
    const previous = currentInstance
    currentInstance = instance
    setupDepth += 1
    try {
      instance.bindings = setup(instance.props, emit, instance.attrs) || {}
    } finally {
      setupDepth -= 1
      currentInstance = previous
    }
  }
  useSyncExternalStore(subscribe, getVersion)
  useLayoutEffect(() => { markRendered() })
  useEffect(() => {
    for (const fn of instance.mounted) fn()
    return () => {
      for (const fn of instance.unmounted) fn()
      for (const stop of instance.stops) stop()
    }
  }, [instance])
  return instance.vm
}

// --- template helpers ------------------------------------------------------

/** Class names from strings, arrays and `{ class: condition }` objects. */
export function cx(...values: unknown[]): string {
  const out: string[] = []
  const add = (value: unknown) => {
    if (!value) return
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) value.forEach(add)
    else if (typeof value === 'object') for (const [key, on] of Object.entries(value)) if (on) out.push(key)
  }
  values.forEach(add)
  return out.join(' ')
}

const refSetters = new WeakMap<object, (value: unknown) => void>()

/** A stable callback ref that writes the element (or exposed API) into `target.value`. */
export function bindRef(target: { value: unknown }) {
  let setter = refSetters.get(target)
  if (!setter) {
    setter = (value) => { target.value = value }
    refSetters.set(target, setter)
  }
  return setter
}

let portalRoot: HTMLElement | null = null

/** The element the app is mounted in: overlays render here so they keep its styles. */
export function setPortalRoot(element: HTMLElement | null) {
  portalRoot = element
}

export function portalTarget(): HTMLElement {
  return portalRoot || document.body
}
