/// <reference types="vite/client" />

/**
 * True in the DeepSeek Harness build, false in the web build.
 *
 * Set by `define` in the Vite config, so it is a literal at build time: the
 * branch that is not taken is removed, together with whatever it imported.
 */
declare const __FORGE3D_EMBED__: boolean
