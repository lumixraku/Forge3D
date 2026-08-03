# Progress

## Current Goal

Run the 3D main chain against the real Tripo API, keeping the simulated path
intact for development without a key. See Real Tripo API Integration below.

## Earlier Goal (done)

Complete and verify the Vue Flow canvas editing canvas, including categorized node creation, typed connections, deletion, and persistence.

## Completed

- Added a categorized node catalog for Input, 2D, 3D, and Video canvases.
- Aligned supported node titles with Lychee Studio: `Image Upload`, `Text Prompt`, `Image to Image`, `Image to 3D`, `Retopology`, and `Texture Model`.
- Added a dedicated `Text to 3D` node with text input, model output, editable 3D parameters, Model Editor support, and planner-generated text-to-3D canvases.
- Added asynchronous mock canvas runs with persisted `queued`, `running`, `succeeded`, and `failed` node states plus a run-status API for frontend polling.
- Generation nodes no longer expose configured preview media before execution; idle and queued nodes show a Generate state, running nodes show progress, and successful nodes show runtime output, duration, Regenerate, and relevant preview/editor actions.
- Kept canvas definitions separate from runtime output by passing `nodeRuns[nodeId]` directly to each canvas node instead of persisting execution state into node configuration.
- Restored each node's latest persisted status, duration, output, and error when a canvas is reopened or the page is refreshed.
- Replaced the accumulated QA canvas with one coherent pipeline: `Text Prompt -> Text to 3D -> Retopology -> Texture Model -> Model Preview`.
- Removed duplicated image inputs, disconnected retopology nodes, repeated retopology, dead-end model branches, and the stale invalid saved fragment.
- Kept `Image to Image` as its own catalog node and stable persisted canvas type so existing canvases and fragments remain valid.
- Applied canonical Lychee titles to existing canvases and imported fragments while preserving names for node types without a Lychee equivalent.
- Moved GLB download into Model Editor instead of representing export as a canvas node.
- Nodes can be created by clicking a catalog item or dragging it onto the canvas.
- Dragging an output connection onto empty canvas opens a catalog filtered to compatible node types; selecting one creates and connects it automatically.
- Added typed `text`, `image`, `model`, and `asset` ports and rejected incompatible connections.
- Node right-side `+` menus now list only compatible successor nodes.
- New nodes are selected automatically and brought into view.
- Standardized Vue Flow edge handles:
  - Source handle: `output`
  - Target handle: `input`
- Implemented and exercised the connection lifecycle through `onConnect`, `onConnectStart`, `onConnectEnd`, and `onConnectCancel` without changing connection direction based on node position.
- Verified node selection in the browser.
- Verified click and drag node creation from the toolbar catalog in the browser.
- Verified node creation and automatic connection from a node's right-side `+` control.
- Verified node configuration editing and automatic save behavior.
- Verified node deletion, including deletion of its incident edges.
- Verified compatible manual edge creation and rejection of incompatible edges.
- Preserved source and target port metadata when saving and loading edges.
- Filtered incompatible legacy edges during canvas loading.
- Anchored the toolbar catalog directly below `+ Add node` and corrected light-theme hover contrast.
- Verified that nodes and edges remain after a forced page refresh.
- Verification commands completed successfully:
  - `npm test`: 20 tests passed
  - `npm run build`: succeeded with existing Rollup comments and chunk-size warnings
  - `git diff --check`: passed

## Fixed: Edge Selection and Deletion

- Edge selection is now included in the canvas selection count and toolbar state.
- The previous verification was invalid because it selected the SVG edge group through keyboard/script events rather than exercising the line's pointer hit area.
- The actual pointer issue was addressed by expanding the invisible edge hit stroke to 36px and handling `pointerdown` at the canvas capture boundary.
- Pointer selection resolves the edge from Vue Flow's `data-id`, selects it, and clears the previous selection unless Shift is held.
- Shift-click can extend the current edge selection.
- The toolbar Delete action removes explicitly selected edges without removing unrelated nodes or edges.
- Deleting selected nodes still removes their incident edges.
- Both `Delete` and `Backspace` are configured as Vue Flow deletion keys.
- Edge deletion continues through the existing debounced persistence flow.
- Browser verification confirmed:
  - `document.elementFromPoint` at the visible path resolves to `.vue-flow__edge-interaction`, confirming that the expanded hit target receives pointer input.
  - Dispatching `pointerdown` to that actual hit-tested element changed the status to `1 selected` and enabled Delete.
  - Toolbar deletion changed the connection count from `7` to `6`.
  - Keyboard Delete changed the connection count from `6` to `5`.
  - Each deletion changed the save state to `Unsaved changes`, then back to `Saved`.
  - A forced refresh retained the first deleted edge, confirming persistence.

## Real Tripo API Integration

The 3D main chain now runs against Tripo v3 instead of the simulation:
`generate-model`, `retopology`, `texture`, `segments`, `rigging`, `export-model`.
The Cloudflare worker stays on the mock.

- `executeNode` takes an optional provider that returns `null` for node types it
  does not back, so the no-key path stays byte-identical.
- A floating debug ball switches Auto / Mock / Tripo API per run; the Tripo
  option is disabled when no key is configured.
- Output urls expire in about five minutes, so each result is copied to
  `server/data/assets/` under its content hash and served from `/api/assets/`.
- The run threads a context of `nodeId -> {tripoTaskId, modelUrl, preview}`,
  seeded from earlier runs, because a real backend cannot read an upstream
  result off the saved canvas the way the simulation does.

### Verified end to end in the browser

Shark reference image through the whole chain, all five nodes green:

| Node | Credits | Output |
| --- | --- | --- |
| Image Upload | – | `shark-reference.png` |
| Gen HD Model | 30 | 3.4 MB `.glb` |
| Retopology | 30 | `.fbx` |
| UV Texture | 10 | textured `.fbx` |
| Export | 10 | 5.3 MB `.glb`, 512x512 thumbnail |

Total 80 credits, 11m28s. Export was also verified as a standalone re-run, and
the exported file downloads from the node with a `glTF` magic number intact.

### Bugs the mock path could not expose

- Input resolution ran against the pruned execution canvas, so a single-node
  run saw no upstream at all.
- The reference-image search stopped at model-producing nodes, so texturing a
  retopologised mesh sent no `texture_prompt` and Tripo failed with
  `reference_image_path not found`. Diagnosed by reading `error_message` off
  `GET /v3/tasks/{id}` — an earlier black-box A/B had produced a confident
  wrong answer.
- An asset download had no retry. The credits are already spent and the url is
  gone in five minutes, so one dropped connection discarded a finished mesh,
  and the error swallowed its cause.
- `run.status` was overwritten per node, so a chain reported `succeeded` as soon
  as its first node landed and the frontend stopped polling.
- A convert task renders no image, so `export-model` had `preview: null` and
  showed a broken thumbnail. It now falls back to the upstream thumbnail.
- The export download only fired from the live polling loop, and from an anchor
  never attached to the document. The node now offers the file directly, which
  also survives a reload.
- Re-running one node could not see what an earlier run produced upstream, so
  exporting a finished chain failed with "Export needs an upstream 3D model".

### Data loss found and fixed

`persistCanvasFiles` used to unlink every canvas file absent from the saving
process's own in-memory list. Two server processes running at once therefore
deleted each other's canvases; three were lost during this work and could not be
recovered, as `server/data/canvases/` is not tracked by git. Saves now only
write, and deletion goes through an explicit `removeCanvas`.

## Shared API Core (2026-08-03, branch `main`)

`server/index.ts` and `worker.ts` were two hand-maintained implementations of the
same HTTP API. The duplication had already produced real divergence, and the
duplicated layer was the one part of the backend with no test coverage at all —
all 15 existing test files imported leaf modules, none exercised either entry
point. The two facts were the same cause: the route table and turn execution were
welded to their runtime, so they could not be tested and could only be kept in
sync by hand.

### Changes

- Added `server/api-core.ts`: the entire route table plus `executeAgentTurn`,
  once, speaking Web-standard `Request`/`Response`. Reaches the outside world
  only through injected ports — `store`, `config`, `waitUntil`.
- Rewrote `server/index.ts` (577 → 106 lines) as the Node binding: http server,
  an `IncomingMessage`/`ServerResponse` bridge that streams SSE bodies chunk by
  chunk, the file-backed store, Tripo, local assets.
- Rewrote `worker.ts` (490 → 92 lines) as the Cloudflare binding: D1-backed
  store, legacy collection migration, static assets.
- Added `server/migrations.ts` for `migrateTurns`, which was duplicated in
  `server/store.ts` and `worker.ts`. It is pure but lived in a module importing
  `node:fs`, which the Worker cannot load; `store.ts` re-exports it.
- `createStore` now accepts `{ dataDirectory }`, and `server/index.ts` honours
  `FORGE3D_DATA_DIR` and `PORT=0`, so tests can spawn it against a temp dir.

### Divergences resolved

- `POST /api/turns/:id/continue` lacked the post-reload state recheck that
  `worker.ts` had, and built its labels from the stale pre-reload `turn` with
  `.find(...).label` and no optional chaining — a 500 where a 409 was correct.
  Both are fixed in the shared core and covered by tests.
- The Worker had no Tripo, no `/api/capabilities`, no `/api/assets`, no serial
  turn queue and no steering. These are now shared code, disabled through
  `config` rather than absent, so `/api/capabilities` reports `tripo: false`
  instead of 404ing at the frontend, which requests it unconditionally.

### Verification

- `npm test`: 182 pass, 0 fail (was 158 before this work; +24 new).
- `npm run typecheck`: clean.
- `npx wrangler deploy --dry-run`: bundles, 100.00 KiB, bindings resolve.
- New `server/api.characterization.test.ts` spawns the real server against a temp
  data directory and covers the endpoint surface. It was written and confirmed
  green against unmodified product code first, so it pins existing behaviour
  rather than intent, then re-run green after the refactor.

### Remaining issues

- SSE broadcast remains per-process, so on Workers a second client served by a
  different isolate does not receive events. Pre-existing and unchanged; the
  shared core makes it one documented limitation instead of two hidden ones.
  A real fix needs Durable Objects.
- The Worker still has no automated coverage of its own. The shared core is
  covered through the Node binding, and `wrangler --dry-run` only proves it
  bundles.

## Node Capabilities From Schema (2026-08-03, branch `main`)

Several places hardcoded lists of node types that the node schema already
described. Verified by comparison before changing anything: the 11 types in
`App.vue`'s `modelTypes` matched the schema's `modelEditor: true` set exactly
(zero difference in either direction), and the 4 types excluded by `run-plan.ts`
matched the non-`executable` set exactly.

### Changes

- Added `isExecutableNodeType()` and `hasModelEditor()` to `src/canvas-schema.ts`,
  reading the `executable` and `modelEditor` flags that were already declared on
  every schema entry but never read.
- Replaced the hardcoded lists in `src/run-plan.ts:16`, `src/App.vue:307`
  (`modelTypes`) and `src/App.vue:173-174` (`sectionEntryNodeId`).
- Replaced the same denylist where it appeared **twice more** in
  `server/mock-runs.ts` (`executionNodes`, `downstreamCanvas`). The server and
  frontend were maintaining separate copies of one rule, so they could have
  disagreed about which nodes run.
- Removed dead code: `nodeRole()` in `canvas-schema.ts` (exported, zero call
  sites, and the last remaining copy of the same list) and the unused
  `structureChanged` parameter on `refreshCanvas` in `useAgentChat.ts`.
  `readCurrent` in `server/index.ts` disappeared with the rewrite above.

### Behaviour change worth noting

The old filters were denylists, so an **unknown** node type counted as
executable; the schema helper is an allowlist, so it does not. Confirmed by
direct check rather than assumed. This is the safer direction — an unknown type
has no runner and would fail anyway — and it now applies identically on both
sides instead of only where each list happened to be maintained.

### Verification

- `npm test`: 182 pass, 0 fail.
- `npm run typecheck`: clean.
- `npm run build`: succeeds.
- `npx wrangler deploy --dry-run`: still bundles after `mock-runs.ts` began
  importing the schema (it is in the Worker's module graph).

### Remaining issues

- None for this change. The `planner.ts:171/181` type lists were deliberately
  left alone: they are default chain templates describing pipeline order, not
  capability rules.

## Fixed: Running A Node That Carries No Work (2026-08-03, branch `main`)

A pre-existing crash found by the characterization tests above, not introduced by
the refactor. `POST /api/nodes/:id/executions` with a frame or an input/output-only
node as the entry point answered **500**: `downstreamCanvas` returns `null` for
such a node (`server/mock-runs.ts`) and `createExecution` passed that `null`
straight into `executionNodes`, which dereferenced `.nodes`. In `node` mode it
did not crash but produced an empty, pointless run.

Unreachable from the UI, which filters those types out before running, so this
only affected direct API use. It was pinned as an explicit `KNOWN BUG` test first
so the refactor could be shown to preserve behaviour, then fixed separately.

### Changes

- `createExecution` now rejects a non-executable entry node with a 400 and a
  message naming the node, before either mode branches. Placed there rather than
  in the route so both runtimes and both modes are covered by one check.
- The pinned test now asserts the fix (400 for both `downstream` and `node`)
  instead of the crash.

### Verification

- `npm test`: 182 pass, 0 fail.
- `npm run typecheck`: clean. `npm run build`: succeeds.
- `npx wrangler deploy --dry-run`: bundles at 100.23 KiB after `executions.ts`
  began importing the schema.

## Fixed: Duplicate Object Keys (2026-08-03, branch `main`)

`npx wrangler deploy` reported two `duplicate-object-key` warnings in the asset
literal in `server/run-assets.ts`: `canvasId` and `canvasRevision` each appeared
twice, on consecutive lines, with identical values. Pre-existing, and harmless at
runtime — last-wins with the same value on both sides — so removing the repeats
provably changes nothing. Confirmed these were the only two such warnings in the
Worker bundle rather than fixing only the reported pair.

### Verification

- `npx wrangler deploy --dry-run`: no warnings, bundles at 100.15 KiB.
- `npm test`: 182 pass, 0 fail. `npm run typecheck`: clean.

### Remaining issues

- None for this change.

## Next Steps

1. Continue browser QA for future canvas interaction changes.
2. Keep node media compatibility rules covered by unit tests when adding node types.
3. Decide whether `GENERATION_NODE_TYPES` in `server/tripo-provider.ts` is
   needed: restricting task-id passthrough to generation nodes is unverified
   caution that costs one extra mesh upload per processing node.
4. Consider backing up `server/data/canvases/` — it holds the only copy of each
   canvas.

## Browser Verification State

- Last confirmed state after typed connection verification: `11 nodes · 5 connections · 0 selected`.
- Edge deletion verification removed `texture -> preview` and `retopology -> texture` from the QA canvas data.
- Browser QA created temporary canvas data, including additional Prompt nodes and connections.
- Browser QA confirmed `Image to Image` and `Text to 3D` as separate catalog entries and verified the Text to 3D media contract, parameter editor, and Model Editor action.
- Browser QA confirmed idle generation placeholders, per-node running/queued transitions, polling through `GET /api/canvases/:canvasId/runs/:runId`, successful runtime previews, durations, and Regenerate actions without console errors.

## Git State

- Current branch: `main`
- Latest feature commit pushed:
  - `3cd85e1 feat: run the 3D main chain against the real Tripo API`
- `.codegraph/` is ignored as local generated project metadata.
- `server/data/canvases/` is not tracked, so a lost canvas cannot be recovered.

## Services

- Frontend: `http://localhost:5175`
- Backend: `http://127.0.0.1:8787`
- `TRIPO_API_KEY` and `TRIPO_BASE_URL` live in `.env`; without them the runner
  falls back to the simulation and the debug ball's Tripo option is disabled.
