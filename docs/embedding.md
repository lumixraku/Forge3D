# Embedding Forge3D in a Host Application

Forge3D runs standalone, but it is also embedded into other Tripo frontends —
currently `fe-tripo-studio` (Nuxt 4 + UnoCSS). This document explains how that
works, why the class names look the way they do, and what to watch out for when
migrating a newer revision into a host.

The guiding principle: **do the isolation work here, so migrating is mostly just
copying files.** A host application should not have to patch its own global CSS
to accommodate Forge3D, and Forge3D should not leak styles into the host's other
pages.

## Why isolation is needed

Standalone, Forge3D owns the whole document. Its stylesheet is free to write
`html`, `body`, `*`, and plain utility names like `.border`. Inside a host, all
of those names collide with the host's own reset and utility layer.

The collision is not symmetric, and the failure mode is not obvious:

- **Host wins over Forge3D.** Tailwind emits utilities inside
  `@layer utilities{}`. Host CSS built by UnoCSS is typically *unlayered*. The
  CSS cascade specifies that **any unlayered declaration beats any layered one,
  regardless of specificity**. So the host's `*{border:0 solid;margin:0}` silently
  overrode `.border`, producing black borders, collapsed padding, and wrong
  line heights — even though `.border` has higher specificity.
- **Forge3D leaks into the host.** Conversely, Forge3D's `html`/`body`/`*` reset
  rules apply to every page of the host app, not just the canvas route.

Patching individual utilities on the host side (e.g. re-declaring
`border-width` for `[class~='border']`) does not scale — it is an endless game of
rebuilding whatever the host reset flattened.

## The two-layer prefix

Forge3D therefore prefixes **all** of its class names, so they simply cannot
collide with a host's.

| Kind | Prefix | Produced by | Example |
| --- | --- | --- | --- |
| Tailwind utility | `forge:` | `prefix(forge)` in `src/styles.css`, at compile time | `forge:border`, `forge:font-mono` |
| Business/semantic class | `forge3d-` | `scripts/prefix-classes.mjs`, plus `bizClass()` at runtime | `forge3d-wbg-label`, `forge3d-tone-cyan` |

Two constraints worth knowing:

- **Tailwind v4 prefixes are variants, not string prefixes.** The syntax is
  `forge:border`, not `forge-border`. This is not configurable — v4 implements the
  prefix as the first variant in the chain, and the `:` separator is hardcoded.
- **The prefix must be lowercase ASCII letters only.** `forge3d` is rejected
  (`Prefixes must be lowercase ASCII letters (a-z) only`), which is why the
  utility prefix is `forge` while the scope class is still `.forge3d-page`.

### Classes that must NOT be prefixed

Third-party libraries identify elements by literal class name. Renaming these
silently breaks behaviour:

| Class | Owner | Why |
| --- | --- | --- |
| `nodrag`, `nopan` | VueFlow | Read by the library to decide drag/pan behaviour |
| `vue-flow__*` | VueFlow | Generated and consumed internally |
| `selected`, `dragging`, `selection`, `draggable` | VueFlow | Added by VueFlow to its own wrapper elements |
| `ProseMirror-selectednode`, `ProseMirror-trailingBreak`, `is-editor-empty` | TipTap/ProseMirror | Internal |

`selected` and `dragging` are the subtle ones: Forge3D *also* has its own
`selected` state on `CanvasNode`'s `<article>` (correctly prefixed to
`forge3d-selected`), while VueFlow puts an unprefixed `selected` on the node
wrapper it renders around it. A selector like
`.vue-flow__node.selected` targets VueFlow's element and must keep the bare name;
`[&.forge3d-selected]` targets ours. Same word, different elements, different owners.

Because of this, the rewriter judges selectors **per compound unit**, not per
`.token`: it splits on combinators and skips any compound containing
`vue-flow__`. Judging each `.token` in isolation cannot tell the two `selected`s
apart — it only knows which element a class sits on by what it is glued to.

## Runtime-composed class names

`scripts/prefix-classes.mjs` rewrites literals in templates, but some class names
are built at runtime from values that originate on the server. Those cannot be
rewritten statically — the prefix has to be composed in JS via `bizClass()` from
`src/class-prefix.ts`:

```ts
// ExecutionOutputPanel.vue — status comes from the API
function statusClass(status: string) {
  return bizClass(`is-${status}`)   // → forge3d-is-succeeded
}
```

Interpolated template literals in `:class` arrays need their static stem
prefixed, leaving the interpolation alone:

```vue
:class="[`forge3d-tone-${data.tone}`, `forge3d-is-${runtimeStatus}`]"
```

The same applies to class names handed to a third-party library in JS, which
never appear in a template at all:

```ts
// useAgentChat.ts — TipTap editorProps
attributes: { class: bizClass('composer-editor') }
```

### Every `:class` form has to be covered

There are four shapes a class literal can take, and the rewriter needs a rule
for each. Missing one is silent: the token stays unprefixed, Tailwind never emits
the utility, and the element renders unstyled with no error anywhere.

```vue
class="a b"                             <!-- static -->
:class="{ 'a': cond }"                  <!-- object key -->
:class="['a b', `stem-${x}`]"           <!-- array literal -->
:class="cond ? 'a b' : 'c d'"           <!-- bare ternary -->
```

The bare ternary is the one that was missed; it cost the node action buttons
(`Export` / `Generate` / `Run downstream`) their whole accent colour scheme.

Note that a single `:class` can mix class literals with **comparison values**:

```vue
:class="{ 'forge3d-active': mode === 'select' }"   <!-- 'select' is NOT a class -->
```

The rewriter tells them apart by position — it only touches literals directly
following `?` or `:`, never the right side of a comparison. When auditing by
hand, the practical heuristic is that utilities contain `-`, `[`, or `:` while
comparison values are bare words.

So: **do not verify prefix coverage by scanning `class=` alone.** Sweep every
quoted literal inside every `:class` and classify each token.

Miss one of these and the symptom is confusing: the CSS rule exists, the element
renders, but a custom property never resolves. Forgetting the `tone-` stem, for
example, left every node's `--node-accent` unset, so the whole canvas rendered
in default grey instead of per-type colours.

## Host-side step: scoping the reset

Prefixing fixes class-name collisions but not the reset rules, which have no
class names to prefix. The host runs one mechanical transform over the compiled
CSS (`fe-tripo-studio/scripts/build-forge3d-css.mjs`, `pnpm forge3d:css`):

1. **Unwrap `@layer`** so Forge3D's rules compete in the same layer as the host's
   unlayered reset instead of automatically losing to it.
2. **Scope only the unprefixed global selectors** — `html`, `body`, `*`, `:root`,
   bare elements (`button`, `a`), pseudo-elements (`::placeholder`,
   `::file-selector-button`, `::-webkit-*`), and attribute selectors
   (`[hidden]`). Prefixed utilities are left untouched.

### Scope with `:where()`, not a bare class

The scope wrapper must be `:where(.forge3d-page)`, whose specificity is always
zero:

```css
/* WRONG — specificity (0,1,1) now beats Forge3D's own utility (0,1,0) */
.forge3d-page button { font-family: inherit }

/* RIGHT — specificity (0,0,1), same as the original `button {}` */
:where(.forge3d-page) button { font-family: inherit }
```

Scoping with a plain class raises the reset's specificity above the utilities it
is supposed to lose to. That regression is easy to miss because it only affects
elements whose styling depends on a utility beating an element selector — buttons
lost `font-mono`, `text-[10px]`, and `bg-bg-input` all at once while everything
else looked fine.

### Do not scope `.vue-flow__*`

VueFlow class names are unique to the library and the host does not use it, so
they cannot collide. Scoping them would break nodes that VueFlow teleports or
renders outside the scope root.

### What `:where()` cannot fix: host `!important` globals

`@tripo3d/design/dist/style.css` ships
`*{line-height:calc(1em + 4px)!important}`. An `!important` declaration beats
every normal declaration regardless of layer or specificity, so neither prefixing
nor scoping stops it — every Forge3D line-height was dead.

Narrow the offending rule at its source rather than escalating. The host adds a
small PostCSS plugin (`fe-tripo-studio/scripts/postcss-exclude-forge3d.mjs`) that
rewrites the selector so the rule never enters the scope:

```css
/* * { line-height: … !important } becomes: */
*:not(:where(.forge3d-page) *):not(.forge3d-page) { line-height: … !important }
```

`:not(:where(…))` keeps specificity unchanged, so the rule still applies to host
elements exactly as before. Inside the scope, Forge3D's own cascade is untouched
and no `!important` is needed on either side.

**Do not answer in kind.** The obvious fix — mark Forge3D's own line-heights
`!important` and add a `* { line-height: inherit !important }` fallback in-scope —
does not work, for a reason worth knowing: **the host recompiles Forge3D's SFCs
itself**, with its own `data-v-*` scope hashes. The `[data-v-…]` rules in the
compiled CSS bundle therefore match nothing in the host; only the host's own
compilation is live, and the build script cannot reach it. Those rules stay
non-important and lose to any `!important` fallback. Two knock-on notes:

- A fallback value of `normal` is wrong regardless. Forge3D's base line-height is
  the unitless `1.5` from Tailwind's `html` preflight, which inherits *as a
  number* so each element multiplies by its own font-size — that is how `<main>`
  computes to 24px and `<small class="text-[11px]">` to 16.5px. `normal` flattens
  that whole chain (observed: 56 elements wrong).
- The scoped-CSS output should contain **zero** `line-height … !important`. If it
  does not, this trap has been re-entered.

Expect to check for host `!important` globals on each migration; they are
invisible to the prefixing strategy.

## Migration checklist

Copy `src/**/*.{vue,ts}` into the host's feature directory, copy
`dist/assets/index-*.css`, then run the host's scoping script. Points to verify:

1. **Respect the file-sync boundary.** Every `src/**/*.{vue,ts}` should be
   byte-identical on both sides except for these, which are the whole diff:

   | File | Status | Why |
   | --- | --- | --- |
   | `api.ts` | **differs — do not overwrite** | Host uses a localStorage guest-storage adapter instead of Feishu auth + real API |
   | `main.ts` | host-absent | Standalone mount entry; the host mounts the app itself |
   | `worker.ts` | host-absent | Cloudflare Worker backend, not client code |
   | `scope.ts`, `CanvasPage.vue` | host-only | Scope constant and page shell |

   A `diff` sweep over that list is the fastest way to confirm a sync landed
   correctly — anything else showing up means the copy was incomplete or an
   adapter got clobbered.
2. **Drop the standalone entry.** Beyond `main.ts`, `src/styles.css` must not be
   copied either — importing the unscoped stylesheet reintroduces the very global
   rules the scoping step removed.
3. **Verify class names against emitted CSS.** The useful check is a set
   difference: every `forge3d-*` name produced by templates or JS should either
   have a matching CSS rule or be a known JS-only hook. Orphans on either side
   indicate a missed rename.
4. **Compare computed styles, not screenshots.** Run standalone and embedded side
   by side and diff `getComputedStyle` over matched elements. Two things make this
   diff trustworthy:
   - Align elements by *class signature* (tag + prefix-stripped sorted class
     list), not DOM position — the host wraps the app in extra elements, so
     positional paths drift by a level and silently compare unrelated nodes.
   - **Skip elements with an empty class list.** Dozens of unstyled `<small>` /
     `<strong>` / `<i>` elements collapse onto one signature key, so each side
     samples a different element and reports differences that do not exist. Only
     class-bearing signatures are meaningful. (Also confirm both pages are on the
     same `data-theme`, or every colour will differ.)

## Files involved

In this repository:

- `src/styles.css` — `@import "tailwindcss" prefix(forge)`
- `src/class-prefix.ts` — `bizClass()` for runtime-composed names
- `scripts/prefix-classes.mjs` — bulk rewrite, idempotent

In `fe-tripo-studio`:

- `scripts/build-forge3d-css.mjs` — unwraps `@layer`, scopes global selectors
- `scripts/postcss-exclude-forge3d.mjs` — narrows host `*{… !important}` globals
  out of the scope; wired up in `nuxt.config.ts`
- `app/features/forge3d/scope.ts` — single source of truth for the scope class
- `app/features/forge3d/CanvasPage.vue` — page shell, height chain, and
  inherited-property resets

## Verification status

Last checked 2026-08-19, against the standalone app at its current revision:
all 80 class-bearing element signatures compare identically across 23 computed
properties (font, colour, border, spacing, layout, shadow). The demo repo builds
clean with 299/299 tests passing, and `scripts/prefix-classes.mjs` is idempotent
(a second run rewrites 0 files).
