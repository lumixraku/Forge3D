# Progress

## 2026-08-11 - main

- Fixed the canvas execution-history endpoint, which referenced an undefined `user` and returned HTTP 500; the Task List therefore only retained the active run instead of loading prior executions.
- The Task List now renders every execution as a separate record keyed by its unique run ID, displays that Task ID, and preserves the entry node name in execution DTOs.
- Added an API regression test that executes the same node three times and requires all three unique execution IDs to appear in canvas history.
- Verification: `pnpm test` passed 227 tests, `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser verification on the running app returned 21 execution records and rendered 21 Task List cards with distinct Task IDs and no console errors. The build retains the existing large-chunk warning.
- Remaining issues: None.

## 2026-08-11 - main

- Cherry-picked and adapted the reference project's execution-isolation and floating Task List commits. The right-side drawer now shows the active run and canvas execution history, tracks task progress, and downloads generated outputs while the bottom panel remains dedicated to run logs.
- Added the canvas-scoped execution creation and history routes, updated the duplicate-node characterization test to use the scoped route, and kept Agent and canvas-run invalidation independent.
- Added `focusNodes`, a reusable canvas focus operation that waits for inserted nodes to render and then animates their collective bounding box into the viewport center with Vue Flow's `fitView`.
- Wired fragment paste to focus all newly inserted node IDs, including cross-canvas pastes and local duplicates; existing single-node focus actions now use the shared capability.
- Verification: `pnpm test` passed 226 tests. `pnpm typecheck`, `pnpm build`, and `git diff --check` also passed; the build retains the existing large-chunk warning.
- Remaining issues: None.

## 2026-08-10 - main

- Fixed the collaborative canvas save loop that shifted node positions whenever a collaborator refocused their tab. `frameInsets` folded `FRAME_TITLE_SCREEN_HEIGHT / zoom` into frame sizes and child positions, which are persisted, so two clients at different zoom levels each refit the received geometry to their own answer and saved it back. Insets and `frameComponentGap` are now zoom-independent and take no zoom argument; the four call sites in `useCanvasFrames` were updated and the now-unused `viewport` dependency was dropped from that composable and its `App.vue` call site.
- Gated `scheduleLayoutSave` on `hasUnsavedCanvasChanges()` so applying a collaborator's canvas cannot save and broadcast a document that was only received. Re-measuring the DOM after `reconcileCanvasGraph` replaces node `data` can queue a frame fit after `suppressFrameFit` has already reopened, since Vue Flow reports dimensions through a ResizeObserver rather than the awaited ticks.
- Replaced the `canvas-layout` test that asserted the old zoom-scaled insets with one pinning zoom independence, and added a `frame-geometry` regression test that refits geometry another client already fitted and requires `changed` to be false.
- Verification: `pnpm test` passed 223 tests, `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. The regression test was bisected against the previous zoom-scaled `frameInsets`: it fails there once the receiving refit uses a different zoom (`frameInsets(0.72)`), which is the real-world case, and passes after the fix. Because the new signature takes no zoom, the committed test cannot express that divergence and so guards the invariant going forward rather than reproducing the original bug. The build retains the existing large-chunk warning. Not verified in a browser: the exact ResizeObserver-versus-tick ordering that makes the receive path save is read from the Vue Flow source, not observed live, so the second change is defense in depth on top of the zoom fix.
- Remaining issues: Two focus-path items found while reading and deliberately left alone as out of scope. `refreshCanvasFromServer` has no `openToken` guard like `openCanvas`, so the `focus` and `visibilitychange` listeners can both fire on tab switch and overlap. `releaseOnBlur` drops the presence lease without reacquiring it on focus, so editing rights wait for the next `ensureEditAccess`.

## 2026-08-10 - main

- Fixed remote focus refreshes so replacing node configuration does not run frame fitting or respond to the transient Vue Flow dimension changes caused by re-rendering node contents. Existing viewport and layout remain untouched; initial canvas hydration keeps the repair path.
- Verification: `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-10 - main

- Fixed canvas stacking so the page top bar and canvas toolbar establish positioned UI layers above all Vue Flow content, with opaque toolbar chrome preventing nodes from showing through button regions.
- Raised Section nodes above regular canvas nodes so their title and Run controls remain visible and interactive when node content overlaps the Section header.
- Verification: `pnpm test` passed 218 tests, `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser verification in the existing Chrome session confirmed the top bar and canvas toolbar have effective positioned z-index layers, hit testing resolves to their controls, and Section nodes render above regular nodes. The build retains the existing large-chunk warning; the only browser console error was an unrelated blocked Google Fonts request (`ERR_CONNECTION_CLOSED`).
- Remaining issues: None.

## 2026-08-10 - main

- Added server-owned canvas revision increments and conditional snapshot replacement using `baseRevision`; stale writes now receive `409` with the current remote canvas instead of overwriting it.
- Added durable browser workflow drafts with an immediate localStorage mirror and IndexedDB persistence, restoring and uploading a draft only when its base revision still matches the remote canvas.
- Split saving into 700ms workflow and 10s layout schedules, retained Agent and execution flushes, and added blur flush plus focus-time remote reconciliation. Remote updates win on an actual revision conflict.
- Fixed blur/page-hide flushing to detect an unsaved graph even if a mutation event was missed, added keepalive page-exit writes, prevented canvas switching from clearing state before flushing it, and converted Vue reactive snapshots to plain data before IndexedDB storage.
- Verification: `pnpm test` passed 218 tests, `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser verification in the existing Chrome session deleted a node, dispatched blur before the debounce completed, and confirmed a `PUT /api/canvases/:id` request; undo plus a second blur also issued the matching restore request. The build retains the existing large-chunk warning.
- Remaining issues: None.

## 2026-08-10 - main

- Replaced the readable JSON canvas clipboard payload with MessagePack bytes stored only under the `web application/vnd.forge3d.canvas-fragment+msgpack` custom clipboard format, without a `text/plain` fallback.
- Added binary decoding with the existing fragment schema and graph validation, while leaving editor paste and unrelated clipboard content unchanged.
- Added regression coverage for binary round trips, non-readable JSON output, malformed bytes, empty fragments, and unsupported schema versions.
- Verification: `pnpm test` passed 218 tests, `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser verification in the existing Chrome session confirmed the clipboard exposed only the custom MessagePack type, contained no `text/plain`, and pasted one encoded node successfully; no console warnings or errors were reported. The build retains the existing large-chunk warning.
- Remaining issues: Web custom clipboard formats require a supporting modern browser; this encoding hides readable structure but is intentionally not encryption.

## 2026-08-10 - main

- Replaced the per-tab canvas clipboard with a versioned system-clipboard fragment format, so the most recently copied selection is the single source used across browser tabs and canvases.
- Added native paste-event parsing and validation, fresh node/edge ID remapping, inserted-selection behavior, and safeguards that leave ordinary text and editor paste unchanged.
- Added clipboard serialization/parsing regression coverage.
- Verification: `pnpm test` passed 218 tests, `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser inspection in the existing Chrome session confirmed the app loaded without console errors and ordinary canvas paste was not intercepted; the build retains the existing large-chunk warning.
- Remaining issues: A physical cross-tab system clipboard gesture still requires manual browser interaction because Chrome automation cannot populate the trusted OS clipboard event path.

## 2026-08-10 - feat/style

- Added a custom Vue Flow execution edge that overlays a bright, animated dash stream on every dependency feeding the currently running node.
- Matched the Flora treatment by keeping a subtle pale node-colored border stationary and moving a compact white glowing point clockwise along the rounded panel perimeter, while preserving the existing card and port indicators.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser inspection used the existing Chrome session at `http://localhost:5176`; a mock execution confirmed the running panel renders without the previous oversized rotating wash. The build retains the existing large-chunk warning.
- Remaining issues: None.

## 2026-08-10 - main

- Fixed the light-theme refresh flash by resolving the saved theme in `index.html` before the stylesheet and Vue application load, so the `data-theme` attribute is present for the first paint.
- Updated the browser theme-color to the light background and applied the same theme synchronously in `useTheme` before component mount.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser inspection at `http://localhost:5176` confirmed the saved `light` preference, applied `light` theme, light color scheme, and `rgb(238, 241, 238)` document background. The build retains the existing large-chunk warning.
- Remaining issues: None.

## 2026-08-07 - main

- Fixed Section auto-fit scheduling so frame changes caused by layout are not treated as child changes that trigger a second global fit pass; selected Section layout now keeps unrelated Sections and their contents stable.
- Verification: `pnpm test` passed 207 tests, `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser verification confirmed selecting one Section and running Auto layout only changed that Section's layout scope; the build retains the existing large-chunk warning.
- Remaining issues: None.

## 2026-08-07 - main

- Made Auto Layout selection-aware: no selection lays out the global root graph; selected nodes lay out only within their own coordinate scope; a Section selected alone lays out its direct contents; and a Section selected with external nodes is treated as one group node without moving its contents.
- Preserved all unselected nodes and Section contents, used descendant edges to connect selected Sections as group nodes, and limited Section refitting to the single-Section content-layout case.
- Added regression coverage for mixed Section/root selection, Section-only layout, selected Section children, and no-selection global layout.
- Verification: `pnpm test` passed 206 tests, `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. The build retains the existing large-chunk warning.
- Remaining issues: None.

## 2026-08-07 - main

- Fixed Ctrl+D duplication to append fresh nodes directly to the rendered graph instead of rehydrating and refitting every Section, so existing nodes no longer move as a side effect.
- Preserved the duplicated nodes' relative layout and parameters with a 24px offset, remapped node/edge/parent IDs, and left duplicated nodes in the default ready state without copying runtime results.
- Added regression coverage for root-node placement, parameter preservation, fresh IDs, remapped edges, and default status.
- Verification: `pnpm test` passed 202 tests, `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. The build retains the existing large-chunk warning.
- Remaining issues: None.

## 2026-08-07 - main

- Consolidated the root `progress.md` history into this existing `docs/progress.md` log and removed the duplicate root file.
- Updated the shared Claude and OpenCode instructions to prefer an existing `docs/progress.md` and use root `progress.md` only as a fallback when the docs file does not exist.
- Verification: confirmed both instruction files use the same fallback rule, all 23 root history entries are retained below, the root file is absent, and `git diff --check` passes.
- Remaining issues: None.

## Migrated History From Root `progress.md`

## 2026-08-07 - main

- Fixed Section duplication to include all descendants, preserve child-local coordinates, remap parent references and internal edges, and wait for graph hydration before selecting the inserted hierarchy.
- Made Fit target the current node selection, including nodes selected inside a Section, while retaining whole-canvas Fit when nothing is selected.
- Made a moved Section adopt overlapping root nodes on drag stop using the same overlap ownership rule as moving a node into a Section; adopted nodes are converted into Section-local coordinates and existing children remain local.
- Verification: `pnpm test` passed 201 tests, `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser verification on the current workspace confirmed duplicating one Section produced the Section, all three children, and both internal edges with preserved local positions; selected child Fit updated the viewport.
- Remaining issues: None.

## 2026-08-07 - main

- Stabilized executable node layout by always rendering the collapsed `Run details` row before and after execution; it remains disabled until details exist and stays collapsed when results arrive.
- Removed the redundant always-visible run message and duration footer that appeared below `Run details` after execution.
- Verification: `pnpm run typecheck`, `pnpm run build`, and `git diff --check` passed. Browser inspection confirmed run and unrun nodes reserve the same details-row height, remain collapsed, and render no footer.
- Remaining issues: None.

## 2026-08-07 - main

- Fixed project duplication so every copied node and edge receives a fresh ID, with frame-parent and edge endpoint references remapped to the copied graph.
- Scoped node execution requests to the active canvas, allowing previously duplicated legacy canvases with overlapping node IDs to run without ambiguous cross-canvas lookup errors.
- Added regression coverage for copied graph identity and canvas-scoped execution.
- Verification: `pnpm test` (198 tests), `pnpm run typecheck`, `pnpm run build`, and `git diff --check` passed.
- Remaining issues: Existing duplicated canvases retain their old node IDs, but canvas-scoped execution now handles them correctly; IDs are regenerated the next time a canvas is duplicated.

## 2026-08-07 - main

- Removed the obsolete bottom margin beneath run action buttons when a node has no run details, restoring balanced card padding after the placeholder footer was removed.
- Verification: `pnpm run typecheck`, `pnpm run build`, and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-07 - main

- Removed the uninformative `Editable parameters` footer from nodes that have no run record; the footer remains available for actual run messages and durations.
- Verification: `pnpm run typecheck`, `pnpm run build`, and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-07 - main

- Increased simulated node execution time from 600 ms to 5 seconds so mock runs keep their executing-state feedback visible long enough to inspect.
- Verification: `pnpm run typecheck`, `node --import tsx --test server/mock-runs.test.ts` (10 tests), `pnpm run build`, and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-07 - main

- Added a prominent percentage progress bar to every executing node result state, using the existing Tripo API progress value and an indeterminate fallback for providers without percentages.
- Added a pulsing glow and expanding halo to the executing node's right output port, with reduced-motion handling.
- Verification: `pnpm run typecheck`, `pnpm run build`, `pnpm test` (197 tests), and `git diff --check` passed. Browser verification against a live Tripo execution confirmed progress updates reached the running node.
- Remaining issues: The existing local development tab was serving an older hot-reloaded component bundle, so the new CSS animation itself was verified through the production build rather than that tab.

## 2026-08-06 - main

- Prevented native browser viewport pinch zoom across the application UI while preserving Vue Flow's canvas-owned pinch zoom and trackpad pinch handling inside `.flow-canvas`.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. The existing local browser tab was running an older bundle, so physical two-finger gesture verification was not available from that session.
- Remaining issues: None.

## 2026-08-05 - main

- Replaced the README product screenshot with the user-provided clipboard capture, which shows a completed conversational 3D reconstruction workflow, Agent tool activity, and the canvas output together.
- Verification: exported the clipboard PNG successfully as `assets/forge3d-canvas-studio.png` (2788x1700) and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-05 - main

- Repositioned the root README as a DeepSeek Agent Harness reference: documented its dual runtime, durable turns and checkpoints, validated shared tools, human-in-the-loop continuation, canvas-scoped SSE, authoritative state reconciliation, and real Tripo-backed workflow execution.
- Added an architecture table, end-to-end execution flow, tool summary, accurate local runtime instructions, known constraints, and prominent links to the implementation-level documentation.
- Verification: `pnpm test` passed 197 tests, `pnpm typecheck` passed, `pnpm build` passed (with Vite's existing large-chunk warning), and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-05 - main

- Replaced the main product screenshot with a light-mode capture and added it to the README introduction.
- Verification: confirmed the `LIGHT` theme was selected in Chrome, the screenshot is 3840x1632, no browser console errors were present, and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-05 - main

- Added a local `POST /api/assets` upload path that writes user files into the existing hashed asset cache and returns a durable `/api/assets/<hash>.<extension>` URL.
- Changed chat attachments to upload before insertion, so message metadata persists the server URL rather than a browser-only Data URL; uploaded images are now readable through the existing static asset route.
- Added coverage for storing an uploaded image. Verification: `pnpm run typecheck`, `pnpm test` passed 197 tests, `git diff --check` passed, and a browser upload of `shark-reference.png` returned and served `/api/assets/b86db8acfe21956a64387b562ab1350a.png` as `image/png`.
- Remaining issues: The Cloudflare Worker has no binary object-storage binding, so this upload route is intentionally available only from the Node server until an R2 bucket is configured.

## 2026-08-05 - main

- Committed the existing attachment card and responsive chat styling changes together with the previously completed port fallback work.
- Verification: `pnpm run typecheck`, `pnpm test` passed 196 tests, and `git diff --check` passed.
- Remaining issues: User-uploaded image thumbnails still use client-side data URLs and do not yet have a server-hosted static URL upload flow.

## 2026-08-05 - main

- Reworked chat attachment rendering so sent user messages retain image thumbnails and file metadata instead of displaying raw attachment text only.
- Added compact attachment cards with constrained filenames, safe wrapping, image preview links, and responsive user-message bubbles.
- Added client-side image thumbnails suitable for durable chat history and preserved attachment metadata through the turn API.
- Verification: `pnpm run typecheck`, `pnpm test` passed 196 tests, and `git diff --check` passed. Browser inspection confirmed the updated chat layout loads without console errors.
- Remaining issues: None.

## 2026-08-05 - main

- Added automatic port probing for both Node HTTP services, incrementing on `EADDRINUSE` instead of crashing.
- Updated `pnpm run dev` to reserve available API and agent-service ports, pass them to child processes, and configure the Vite API proxy with the resolved API port.
- Added a regression test for Node port fallback.
- Verification: `pnpm run typecheck`, `node --import tsx --test server/listen.test.ts`, `git diff --check`, and an end-to-end `pnpm run dev` startup check passed. Existing occupied ports were skipped successfully.
- Remaining issues: None.

## 2026-08-05 - main

- Enabled Vite's built-in port fallback so the web dev server increments from port 5175 when the requested port is occupied.
- Verification: `pnpm run typecheck` passed. An integration check occupied port 5175 and confirmed `pnpm run dev:web` started on port 5176.
- Remaining issues: None.

## 2026-08-05 - main

- Changed the chat composer to use one action button that switches between Send, Stop, and Stopping states.
- Preserved the existing send and stop-turn events and their disabled behavior.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser inspection confirmed exactly one composer action button and no console errors.
- Remaining issues: None.

## 2026-08-05 - main

- Reverted the added outer chat-message frames and restored the original message spacing and user bubble treatment; user-selection cards retain their existing borders.
- Kept the top-bar control sizing normalization unchanged.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-05 - main

- Normalized top-bar button group heights and minimum widths so the canvas switcher, workspace switcher, theme switcher, and canvas tools align consistently.
- Added a consistent subtle border and surface to every chat message, including assistant messages, while preserving the stronger user-message treatment.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-05 - main

- Cherry-picked Tripo commit `5265573` from merge commit `5014ba7e43092b1c2af3b8d5e9d34b2b60196fc0` to simplify agent selection recovery.
- Integrated it with the durable harness by preventing startup recovery from re-queuing turns that already have a pending user-selection request.
- Verification: `pnpm test` passed 193 tests; `pnpm typecheck`, `pnpm build`, and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-05 - main

- Removed the composer keyboard shortcut hint and replaced the attachment and send/stop text controls with circular icon buttons.
- Kept the right-hand control as one button that switches from a send arrow to a stop square while an agent turn is running.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser inspection confirmed the hint is absent, both controls are 34px circles with SVG icons, and there are no console errors.
- Remaining issues: None.

## 2026-08-05 - main

- Refined the composer into a compact 99px control and grouped the attachment and send/stop actions at the lower right instead of stretching them across the panel.
- Reduced both icon buttons to 30px, softened the attachment control, and tightened the focus treatment and internal spacing.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser inspection confirmed the compact dimensions, right-aligned controls, and no console errors.
- Remaining issues: None.

## 2026-08-05 - main

- Stopped downloading new Tripo outputs into server storage and retained each Tripo task ID as the stable reference for exports.
- Added an owned-task download endpoint that refreshes the task on demand and redirects to its current model URL without proxying or caching the asset bytes; retained the legacy local asset reader for older runs.
- Added regression coverage for refreshed downloads, task ownership, stable export links, and non-persisted Tripo results.
- Verification: `pnpm test` passed 195 tests; `pnpm typecheck`, `pnpm build`, and `git diff --check` passed.
- Remaining issues: Tripo preview image URLs are still the temporary URLs returned when a task completes; only model downloads are refreshed on demand.

## Agent Harness: 2026-08-05

- Added persisted, sanitized Agent traces and resumable checkpoints for both the direct DeepSeek loop and the Pi Agent service.
- Added `GET /api/turns/:turnId/trace`, trace event sequencing, terminal statuses, attempt/resume counters, and startup recovery for queued/interrupted Node turns.
- Added offline fixture-driven Agent evals via `pnpm agent:eval`; fixed model responses assert DAG structure, parameter updates, trace events, secret redaction, and checkpoints.
- Verification: `pnpm agent:eval` passed 3 tests; `pnpm test` passed 192 tests; `pnpm typecheck` passed; `pnpm build` passed; `git diff --check` passed.
- Remaining issues: exact in-flight continuation across Cloudflare Worker isolate eviction still requires Durable Objects. None beyond that limitation.

> This file is the required repository progress log. Documentation entry points
> are in the root `README.md` and this `docs/` directory.

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

## Draggable Debug Ball With Corner Snapping (2026-08-03, branch `main`)

The debug ball was pinned to `right: 18px; bottom: 120px` and could cover canvas
content with no way to move it. It now drags and snaps to whichever of the four
corners it is released nearest, defaulting to bottom-left.

### Changes

- `DebugPanel.vue` tracks a `corner` ref persisted to
  `localStorage['forge3d.debugBallCorner']`, following the same guarded
  read/write as `useDebugSettings`, so a blocked store falls back to the default
  instead of throwing.
- Position moves from static CSS to a computed inline style: pointer coordinates
  while dragging, corner offsets while docked. All four edges are always emitted
  as `left/right/top/bottom` — Vue merges style objects rather than replacing
  them, so returning only `left`/`top` mid-drag would leave the docked
  `right`/`bottom` in place and pin the ball to two opposite edges at once.
- Drag uses pointer events on `window`, so the gesture survives the pointer
  leaving the 52px ball. Movement under 4px stays a click, so an unsteady press
  still opens the panel; `dragging` is cleared in a `requestAnimationFrame` after
  `pointerup` so the trailing click does not toggle the panel.
- Drag position is clamped to the viewport, so the ball cannot be dropped past an
  edge and stranded.
- The panel opens toward the middle of the screen via `flex-direction` on the
  dock, keyed off the docked corner.

### Verification

Exercised in the browser through Chrome DevTools against the dev server, not
inferred from the CSS:

- Default with no stored value is bottom-left (`left: 18px`, `bottom: 18px`).
- Dragging to each corner snaps the ball to exactly 18px from both its edges and
  persists the right value (`top-right`, `bottom-right`, `top-left`,
  `bottom-left`).
- Dragging to `(-500, -500)` clamps to `(18, 18)`.
- A click with no movement still toggles the panel; a drag does not.
- With the panel open in all four corners: the ball stays pinned to its corner,
  the panel is fully within the viewport, and it grows inward.
- `npm run typecheck` clean, `npm run build` succeeds, `npm test` 186 pass.

### Bug found by measuring rather than reading

The first implementation had `flex-direction` inverted. The panel precedes the
ball in the DOM, so `column-reverse` put the ball *above* a bottom-docked panel:
opening the panel made the ball jump off its corner from y=701 to y=389. Only
visible by measuring both rectangles with the panel open — the CSS read as
correct. Fixed by swapping the two directions.

### Remaining issues

- The corner is not re-clamped on window resize. Because position is expressed as
  corner offsets rather than absolute coordinates, the ball stays correctly
  docked at any viewport size; only an in-progress drag would be affected, which
  cannot span a resize.

## Fixed: The Rename Left The API Key Behind Too (2026-08-03, branch `main`)

`DEEPSEEK_API_KEY` appeared to have vanished after the domain moved to
`forge3d-canvas-studio`. It had not been deleted — it was never set on that
worker. Secrets are stored per worker, not in `wrangler.toml` (correctly, since
they are credentials), so the worker created by the `263b56e` rename started
with none. `wrangler secret list` returned `[]` for `forge3d-canvas-studio` and
`[{ DEEPSEEK_API_KEY }]` for `forge3d-workflow-studio`.

This stayed invisible while the domain still pointed at the old worker, which
had the key. Moving the domain exposed it. The third consequence of the same
one-line rename, after the stranded domain and the unmigrated collections.

### Changes

- Set `DEEPSEEK_API_KEY` on `forge3d-canvas-studio`, piped from `.env` into
  `wrangler secret put` so the value never entered a command line or any output.

### Verification

Not just "the secret is registered" — the agent path was exercised end to end
against the live domain. A temporary canvas was created, `POST
/api/sessions/:id/turns` accepted `say hi`, and `chat-history` came back with a
real DeepSeek reply ("Hi there! 👋 I'm ready to help you build on your 3D
production canvas"). The temporary canvas was then deleted and the list
confirmed back at 11 with no leftovers.

### Note

`DELETE` for a canvas is `/api/projects/:id` (`api-core.ts:365`), not
`/api/canvases/:id` — the latter 404s. Worth knowing when cleaning up test data.

### Remaining issues

- The retired worker `forge3d-workflow-studio` still holds its own copy of the
  secret. Harmless (it serves no domain), but it is a live credential on an
  unused worker; deleting that worker would remove it.
- No other secrets were ever set on either worker, so nothing else is missing.
  `AGENT_SERVICE_URL` is read by `worker.ts` but is unset in production, which is
  the existing behaviour and not new.

## Why Tripo Cannot Run On Cloudflare (2026-08-03, investigation, no code change)

The debug panel reports **"Tripo API — No API key"** on
`https://forge3d.lumixraku.org`. This is not a missing secret. `worker.ts:77`
hardcodes `createTripoProvider: null` and `readAsset: null`, so
`/api/capabilities` returns `tripo: false` and the frontend greys the option out.
**Setting `TRIPO_API_KEY` as a Worker secret would change nothing** — that code
path never reads it. The behaviour is deliberate and the comment above it says so.

### The two real blockers

**No filesystem.** Tripo output URLs expire about five minutes after a task
succeeds, so `server/tripo-assets.ts` writes every artifact to
`server/data/assets/` using `node:fs` (`mkdir`/`writeFile`/`rename`) and serves it
back through `/api/assets/`. Reference images are read from `public/` the same
way (`tripo-provider.ts:74`). Neither existing binding substitutes:

| Binding | What it is | Why it cannot hold Tripo output |
| --- | --- | --- |
| `DB` (D1) | SQLite for canvas/session/run JSON | Structured data. Multi-MB `.glb` blobs would hit row-size limits and be scanned on every list read. |
| `ASSETS` | Static assets from `./dist-cloudflare` | **Read-only**, fixed at deploy time. Serves the frontend bundle. |

This needs R2. R2 has never been configured (`git log -S r2_buckets` across all
refs is empty) and is **not enabled on the account**: `wrangler r2 bucket list`
returns `code: 10042, Please enable R2 through the Cloudflare Dashboard`. That is
a dashboard step, not something the CLI can do.

**Runtime length.** The verified 3D chain took **11m28s**, driven by a polling
loop at `tripo.ts:137` waiting on task completion. That exceeds a Worker request,
and `ctx.waitUntil` does not cover it either.

### What a fix would take

Two independent steps, in this order:

1. **Storage** — enable R2, add the binding, rewrite `tripo-assets.ts` off
   `node:fs`, point `/api/assets/` at R2, and stop reading reference images from
   `public/`. Independently verifiable (upload then read back) and does not touch
   the execution chain.
2. **Long-task scheduling** — move the polling loop out of the request lifecycle
   into Durable Objects or Queues. Touches the core of how runs execute.

Not started: step 1 is blocked on the account-level R2 step, and both are a
larger change than the question implied. Tripo runs today on the local Node
server (`npm run dev`), which is verified end to end — see the shark run above,
five nodes green, 80 credits.

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
- A backup of all six D1 collections, taken before the canvas migration, lives at
  `~/backups/forge3d-d1/2026-08-03-pre-canvas-migration/` (`workflows.json` 11
  records, `tasks.json` 20, `sessions` 11, `conversations` 11, `runs` 2,
  `fragments` 0, plus a `README.md` explaining the restore path). Verified by
  SHA-256 against the originals and by parsing each file. Deliberately outside
  the repo — it is production data, not source. The migration seeds the new
  collections and leaves the legacy rows in place, so this copy is redundant, but
  D1 `9b7fb975` is the only home for these canvases.

## Services

- Frontend: `http://localhost:5175`
- Backend: `http://127.0.0.1:8787`
- **Production is `https://forge3d.lumixraku.org` — this is the deploy target.**
  Worker `forge3d-canvas-studio`, D1 `forge3d` (`9b7fb975-...`). Deploy with
  `npm run cf:deploy` and verify against this domain only. Its last line prints
  `forge3d.lumixraku.org (custom domain)`; if it prints a `.workers.dev` URL
  instead, the `[[routes]]` block is missing and the deploy went nowhere useful.
  Never verify a fix against a `.workers.dev` URL — the user is on the custom
  domain and will see no change.
- `.workers.dev` is disabled: `workers_dev` is not declared, and once
  `[[routes]]` exists wrangler disables it by default (with no route it would be
  enabled by default, which is why pre-`ac786ce` deploys landed there). Add
  `workers_dev = true` only if a staging URL is explicitly wanted.
- The retired worker `forge3d-workflow-studio` still exists in the account, bound
  to the same D1. It served the custom domain until 2026-08-03 and its own last
  deployment is `7f072d1f` at 2026-08-03T07:49 UTC — that version is current
  code, pushed there during the wrong turn described above, not the stale
  pre-rename build. It now serves no domain (`.workers.dev` disabled, so its
  hostname 404s). Deleting it would be safe but has not been done; it shares the
  D1, so deleting the worker would not touch any data.
- `TRIPO_API_KEY` and `TRIPO_BASE_URL` live in `.env`; without them the runner
  falls back to the simulation and the debug ball's Tripo option is disabled.

## Documentation Restructure (2026-08-04, branch `main`)

- Added `todo.md` with the Tripo OpenAPI `task_id` operation-history and durable
  asset-recovery work items.
- Moved the detailed project reference from the root `README.md` to
  `docs/project-reference.md`.
- Moved `api.md` to `docs/api.md` and added cross-links from the root README and
  detailed references.
- Kept only the entry-point README in the repository root; documentation files
  remain under `docs/`.
- Verification: checked the Markdown inventory, updated relative image/link
  paths, and confirmed the working tree contains the intended documentation
  changes. Tests were not run because this change only reorganizes Markdown.
- Remaining issues: None.
## 2026-08-10 - main

- Added process-local canvas edit leases with 30-second expiry, 10-second client renewal, immediate release on canvas/page exit, SSE presence updates, and lease enforcement for canvas saves and Agent edits.
- Added edit-idle release: actual workflow changes reset a 30-second timer; after inactivity the client flushes pending changes and releases the lease. Saving, Agent turns, and canvas execution defer release until work completes. Viewing, selection, panning, zooming, and tab visibility do not count as edits.
- Corrected focus-loss handling so window blur itself, a hidden document, and page exit each flush pending changes and send the lease `DELETE` immediately. Release now keys off the locally acquired canvas ID rather than transient SSE lease state, so blur cannot skip the request.
- Added per-tab guest identities, read-only interaction guards, current-editor status, and a dismissible top notice naming the active editor.
- Limited the active-editor notice to three seconds per display, including when a user attempts a blocked edit; its timer is cleared when the app unmounts.
- Changed presence from an edit lock to an advisory signal: another editor triggers the three-second notice but no longer blocks canvas interaction, rename, saves, or Agent messages. Revision checks still return `409` for genuinely stale snapshots.
- Kept the advisory editor notice visible for the full three-second duration by removing its immediate close action and storing the detected editor name separately from live presence; a chained release event can no longer unmount the notice early.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. The build retains the existing large-chunk warning.
- Verification: `pnpm test` passed 219 tests, `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Focus-loss correction was rechecked with `pnpm test`, `pnpm typecheck`, and `git diff --check`. The build retains the existing large-chunk warning. Browser re-verification was blocked because the existing localhost Chrome tabs stopped responding to Chrome MCP reload and snapshot requests.
- Remaining issues: Process-local leases require shared TTL storage for multi-instance deployment; complete the two-tab 30-second idle handoff check when the existing Chrome session responds.
