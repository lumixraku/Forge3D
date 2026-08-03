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

## Fixed: The Custom Domain Was Stranded On The Old Worker (2026-08-03, branch `main`)

`https://forge3d.lumixraku.org/` still served the pre-rename app, five days after
the code had moved on. `263b56e refactor: rename` (2026-07-30 13:58) changed one
line in `wrangler.toml`:

```diff
-name = "forge3d-workflow-studio"
+name = "forge3d-canvas-studio"
```

`name` is the worker's identity on Cloudflare, so this did not rename anything —
it started deploying to a **second** worker. The custom domain stayed bound to
`forge3d-workflow-studio`, whose last deployment was 2026-07-29 08:16 UTC. Every
deployment after the rename, including two of mine, went to a worker nobody was
looking at.

Diagnosed by fingerprinting both hosts rather than by reading config: the domain
served `index-Bhbv__Az.js` plus a `rolldown-runtime-*.js` chunk this build does
not emit, and `/api/workflows` returned the exact `wf-51ac6d5f-...` record from
the user's screenshot while `/api/projects` 404'd. The old worker name served
byte-identical responses, which is what confirmed it.

### Changes

- `wrangler.toml` declares the custom domain via `[[routes]]` with
  `custom_domain = true`, so the domain travels with the worker and a future
  rename cannot silently strand it again.
- Worker name kept as `forge3d-canvas-studio`; the domain was moved to it rather
  than reverting the name, since `workflow` is gone from the product vocabulary.

### What was actually misconfigured on Cloudflare

Nothing was misconfigured *in* Cloudflare. Cloudflare did exactly what it was
told. The bug was that `wrangler.toml` never recorded which worker owned the
domain, so the binding lived only in Cloudflare's own state:

- `wrangler.toml` declared `name` and nothing else about routing — no
  `[[routes]]`, no `workers_dev`. The custom domain existed **only** as a
  dashboard-side binding on `forge3d-workflow-studio`.
- `name` is the worker's primary key. Editing it does not rename the worker; the
  next `wrangler deploy` creates a second, empty worker under the new name. The
  old worker keeps running, keeps its routes, and keeps serving the domain.
- So after `263b56e` the account held two workers. `wrangler deploy` updated
  `forge3d-canvas-studio`; the domain kept pointing at `forge3d-workflow-studio`,
  frozen at its 2026-07-29 08:16 UTC deployment.
- Wrangler printed no warning. It reports the URL it deployed to
  (`...workers.dev`), never the URL that used to be served, so the output looked
  successful every time.

Both workers were bound to the same D1 (`database_id = 9b7fb975-...`), which is
why the old deployment kept accumulating writes the whole time — `workflows` had
an `updated_at` **later** than the new worker's first deployment, which is what
proved the old one was still live and in use.

### Why probing did not catch it sooner

Two dead ends worth not repeating:

- `wrangler deployments list` shows `Source: Upload` and
  `Message: "Automatic deployment on upload."` with no git metadata, so **the
  deployed commit is not recoverable from Cloudflare**. Version IDs are UUIDs
  with no commit association. Comparing built asset hashes against the local
  `dist-cloudflare/index.html` is the only reliable version check.
- Guessing the hostname wasted time: the `.workers.dev` subdomain is
  `forge3d.workers.dev`, not `<account>.workers.dev`, and local DNS resolved the
  guess to `208.43.170.231` (not a Cloudflare IP) with TLS failing through the
  proxy. `wrangler deploy` prints the true URL on its last line — read that
  instead of constructing one. Public internet from this machine needs
  `HTTPS_PROXY=http://127.0.0.1:7897`; `npm run cf:deploy` unsets it on purpose.

### Two wrong turns taken while fixing this

Recorded because both were avoidable and cost a deploy each:

- Reverting `name` to `forge3d-workflow-studio` and deploying. That does reach
  the domain, but it reintroduces the retired `workflow` vocabulary. The correct
  direction was to move the domain to the canvas-named worker, which is what
  shipped.
- Treating the blank page as purely a data problem. The missing `New` button was
  an independent UI deadlock (see below) with no relation to the migration; it
  would have made any empty database unusable even with the domain and data both
  correct. Read the UI before concluding an empty screen means empty data.

### Note

`workers_dev` is not declared, so this deployment disabled the `.workers.dev`
URL. Only the custom domain serves the app now. Set `workers_dev = true` if the
`.workers.dev` URL is wanted back as a staging target.

## Fixed: The Rename Shipped No Data Migration (2026-08-03, branch `main`)

The same rename renamed the D1 collections — `workflows` -> `canvases`,
`tasks` -> `turns` — and rewrote `migrations/0001_initial.sql`, but shipped no
migration for data already written. The deployed database therefore held 11
canvases under `workflows` and 20 turns under `tasks`, while the new code read
`canvases`/`turns` and found nothing. `migrations/` is now an empty, untracked
directory. Pointing the domain at the new worker made the app render empty.

Verified against a full backup of all six collections before changing anything.
The record shape needed no conversion: the old `workflows` rows already carried
`schemaVersion, id, name, description, revision, createdAt, updatedAt, nodes,
edges, viewport`, and nodes already carried `id, type, name, config, ui`. Only
the collection names and the `workflowId`/`workflowRevision` foreign keys
differed.

### Changes

- Added `migrateCanvasRefs` to `server/migrations.ts`: renames `workflowId` ->
  `canvasId` and `workflowRevision` -> `canvasRevision`, returning each record
  by identity when there is nothing to do, matching `migrateTurns`. An existing
  `canvasId` wins over a stale `workflowId`.
- `worker.ts` `loadState` seeds `canvases` from `workflows` and `turns` from
  `tasks` when the new collection is absent, then applies `migrateCanvasRefs` to
  `sessions`, `runs` and `turns`. The legacy rows are read-only and left in
  place as a backup.
- `server/store.ts` re-exports `migrateCanvasRefs` alongside `migrateTurns`.

### Verification

- 4 new tests in `server/store.test.ts` covering the rename, the revision field,
  identity on an already-migrated record, and the stale-`workflowId` conflict.
- `npm test`: 186 pass, 0 fail (was 182). `npm run typecheck`: clean.
- Post-deploy, `GET /api/projects` on the custom domain returns all 11 canvases
  with node counts intact (19 for `游戏人物高模2`, 18 for `游戏室内场景`).

## Fixed: The First Canvas Could Never Be Created (2026-08-03, branch `main`)

With an empty canvas list the app rendered a blank page with no way out. Found
by looking at the UI rather than the data, after mistakenly treating an empty
screen as purely a data problem.

`TopBar.vue` wrapped the canvas switcher **and the `New` button** in
`v-if="activeCanvas"`. `useCanvasDocument.ts:72` leaves `activeCanvas` null when
the list is empty, because `id` resolves to `undefined` and `openCanvas` never
runs. No canvas meant no `New` button meant no way to create one — a deadlock
that made every fresh database permanently unusable, independent of the domain
and migration issues above.

### Changes

- `TopBar.vue` renders the switcher group and `New` in a `v-if="!activeCanvas"`
  branch as well, with a "No canvases yet" note inside the empty switcher panel.
  `Import JSON` is reachable there too, so an exported canvas can be restored
  into an empty database.

### Verification

- `npm run typecheck`: clean. `npm run build`: succeeds. `npm test`: 186 pass.
- The deployed bundle `index-CHK81izb.js` contains the new branch, confirmed by
  requesting it directly through the custom domain.

### Remaining issues

- The empty-state branch duplicates the switcher markup rather than hoisting it
  out of the `v-if`. Deliberate: hoisting means restructuring the populated
  branch too, and this needed to ship as a small, verifiable change.
- Not verified in a browser. Chrome MCP could not attach (`Could not find
  DevToolsActivePort`), so this rests on the bundle check and the type/build
  pass, not on a rendered page.

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
- Latest commit pushed:
  - `ac786ce fix: reconnect the custom domain and recover the renamed data`
- `.codegraph/` is ignored as local generated project metadata.
- `server/data/canvases/` is not tracked, so a lost canvas cannot be recovered.
- A backup of all six D1 collections taken before the migration lives under
  `scratchpad/d1-backup/` in the session temp directory (`workflows.json` 62 KB,
  `tasks.json` 158 KB, plus `sessions`, `conversations`, `runs`, `fragments`).
  **On `/tmp`, so it will be cleaned up** — move it if it needs to survive.

## Services

- Frontend: `http://localhost:5175`
- Backend: `http://127.0.0.1:8787`
- Production: `https://forge3d.lumixraku.org` — worker `forge3d-canvas-studio`,
  D1 `forge3d` (`9b7fb975-...`). The domain is declared in `wrangler.toml`, so
  `npm run cf:deploy` reaches it. `.workers.dev` is disabled.
- The retired worker `forge3d-workflow-studio` still exists in the account, bound
  to the same D1. It served the custom domain until 2026-08-03 and its own last
  deployment is `7f072d1f` at 2026-08-03T07:49 UTC — that version is current
  code, pushed there during the wrong turn described above, not the stale
  pre-rename build. It now serves no domain (`.workers.dev` disabled, so its
  hostname 404s). Deleting it would be safe but has not been done; it shares the
  D1, so deleting the worker would not touch any data.
- `TRIPO_API_KEY` and `TRIPO_BASE_URL` live in `.env`; without them the runner
  falls back to the simulation and the debug ball's Tripo option is disabled.
