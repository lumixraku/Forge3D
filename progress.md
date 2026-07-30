# Progress

## Current Goal

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

## Next Steps

1. Continue browser QA for future canvas interaction changes.
2. Keep node media compatibility rules covered by unit tests when adding node types.
3. Replace the deterministic mock runner with a real execution backend when service integrations are available.

## Browser Verification State

- Last confirmed state after typed connection verification: `11 nodes · 5 connections · 0 selected`.
- Edge deletion verification removed `texture -> preview` and `retopology -> texture` from the QA canvas data.
- Browser QA created temporary canvas data, including additional Prompt nodes and connections.
- Browser QA confirmed `Image to Image` and `Text to 3D` as separate catalog entries and verified the Text to 3D media contract, parameter editor, and Model Editor action.
- Browser QA confirmed idle generation placeholders, per-node running/queued transitions, polling through `GET /api/canvases/:canvasId/runs/:runId`, successful runtime previews, durations, and Regenerate actions without console errors.

## Git State

- Current branch: `feat/canvas-fragments`
- Latest feature commit pushed:
  - `29215fc feat: add typed canvas node connections`
- Lychee node title alignment is implemented and locally verified.
- `.codegraph/` is ignored as local generated project metadata.

## Services

- Frontend: `http://localhost:5174`
- Backend: `http://127.0.0.1:8787`
