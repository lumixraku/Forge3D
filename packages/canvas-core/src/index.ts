// The canvas domain, in one place.
//
// Every module here is pure TypeScript: no UI framework, no DOM, no Node built-ins. That
// is what lets the web app, the HTTP server and the DeepSeek Harness plugin
// share one definition of what a canvas is instead of three drifting copies.
//
// `canvas-nodes` re-exports most of `canvas-schema`; both star exports resolve
// to the same declarations, so the barrel stays unambiguous.

export * from './canvas-schema'
export * from './canvas-nodes'
export * from './canvas-graph'
export * from './canvas-result-slots'
export * from './canvas-layout'
export * from './wire-tie'
export * from './starter-canvas'
export * from './frame-geometry'
export * from './canvas-results'
