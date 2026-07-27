# Forge3D Workflow Studio

[Live Demo](https://forge3d.lumixraku.org/)

Forge3D is a local-first, conversational workflow studio for designing reusable 3D production pipelines. A DeepSeek-powered Agent translates natural-language requests into a versioned JSON directed acyclic graph (DAG), while Vue Flow renders that domain model as an editable infinite canvas.

The repository is both a working demo and a reference implementation. This README describes the product, interaction model, data contracts, rendering rules, Agent protocol, persistence, local runtime, Cloudflare deployment, and known limitations in enough detail for another engineer or AI coding agent to reproduce the project.

Chat requires a DeepSeek API key. Workflow execution is intentionally simulated: no external image-generation, mesh-generation, retopology, rigging, texture, or export service is called.

![Forge3D Workflow Studio](assets/forge3d-workflow-studio.png)

## Product Goals

Forge3D combines two editing modes over the same authoritative workflow document:

1. **Conversational editing**: the Workflow Copilot inspects, builds, and updates the graph through validated tools.
2. **Direct manipulation**: the user adds, connects, moves, groups, configures, copies, runs, imports, and exports nodes on the canvas.

The important architectural boundary is that Vue Flow is a renderer and interaction surface, not the persisted data model. The server owns a framework-neutral workflow JSON document containing domain nodes, semantic edges, viewport state, revision metadata, conversation history, Agent tasks, and mock execution runs.

## Current Product Surface

The page has two mutually exclusive workspace modes:

- **Workflow workspace**: top bar, Workflow Copilot on the left, and an infinite node canvas on the right.
- **Model Editor workspace**: a focused 3D result viewer opened from successful model-producing nodes.

### Top Bar

The top bar contains:

- Forge3D brand and product subtitle.
- Current workflow name and zero-padded revision.
- Workflow switcher.
- New workflow action.
- Save state: `Unsaved changes`, `Saving…`, `Saved`, or `Save failed`.
- Light/dark theme switcher.

Double-click the current workflow name to rename it. `Enter` saves, `Escape` cancels, and blur commits a non-empty changed value.

### Workflow Copilot

The left panel is a Tiptap-powered chat composer and conversation history:

- User messages are labeled `YOU`; assistant messages are labeled `FORGE`.
- `Cmd+Enter` on macOS or `Ctrl+Enter` elsewhere sends a message.
- Enter inserts a normal line break.
- Multiple attachments can be inserted into the composer.
- Image attachments receive local object-URL previews.
- Attachments are currently serialized to text as `[Attachment: filename]`; binary files are not uploaded to the server.
- Assistant Markdown uses GFM and line breaks via `marked`, then passes through DOMPurify with raw HTML disabled.
- Safe progress labels are streamed while the Agent runs.
- Raw model reasoning, raw tool arguments, and raw tool outputs are not exposed.
- Completed tool activity can be collapsed under the assistant response.
- The Agent can pause and render a generic single- or multi-select question card.

### Infinite Canvas

The canvas is implemented with Vue Flow and includes:

- Free node positioning.
- Directed connections.
- Partial-intersection box selection.
- Shift multi-selection.
- Frame grouping and nesting.
- Copy, paste, duplicate, and delete.
- Drag-to-create nodes from the Add node menu.
- Drag a connection onto empty canvas to open a compatible-node menu.
- A per-node `+` action that creates and connects a downstream node.
- ELK automatic layout.
- Fit-to-view.
- Background grid.
- Pannable and zoomable MiniMap.
- Vue Flow controls.
- Persisted viewport.

The precise Vue Flow configuration is:

| Setting | Value |
| --- | --- |
| Minimum zoom | `0.08` |
| Maximum zoom | `3.5` |
| Grid snapping | Disabled |
| Pan on scroll | Enabled |
| Zoom on scroll | Disabled |
| Selection mode | Partial intersection |
| Multi-select key | `Shift` |
| Background gap | `24` |
| Background dot size | `1.2` |
| MiniMap position | Bottom right |
| MiniMap size | `160 x 100` |
| MiniMap pan/zoom | Enabled |

Drag-to-pan is enabled for coarse pointer devices. Application code handles deletion instead of Vue Flow's built-in delete key behavior.

### Canvas Toolbar

The toolbar provides:

- `+ Add node`: open the categorized node catalog.
- `Frame`: create a frame immediately.
- `Gen HD Model`: create a `generate-model` node immediately.
- `Fit`: fit all nodes with `0.18` padding and a 400 ms transition.
- `Auto layout`: run ELK layout and persist the result.
- `Run workflow` / `Run again`: start simulated execution.

Auto layout is disabled while the Agent or save operation is busy and when the graph is empty. Workflow execution is disabled while another run or blocking operation is active.

## Workflow Management

The workflow switcher shows each workflow name, node count, and revision. It supports:

- Open workflow.
- Create workflow.
- Import JSON by picker or drag-and-drop.
- Export JSON.
- Duplicate.
- Delete with confirmation.

Creating a workflow asks for a name with `window.prompt` and defaults to:

```json
{
  "name": "New 3D workflow",
  "description": "A new 3D production workflow ready to customize.",
  "nodes": [],
  "edges": [],
  "viewport": { "x": 80, "y": 160, "zoom": 0.72 }
}
```

Import removes external `id`, `revision`, `createdAt`, and `updatedAt` fields, then creates a new workflow rather than overwriting the current one. Export downloads pretty-printed JSON as `<workflow-name>.workflow.json`.

Duplication deep-copies nodes, edges, and viewport, resets the revision to 1, names the copy `<original> Copy`, and creates a separate conversation.

### Autosave

Canvas edits are debounced for 700 ms. Saves are serialized:

1. The current domain snapshot is placed in a pending slot.
2. Only one `PUT` request runs at a time.
3. If edits occur during the request, the newest pending snapshot is saved afterward.
4. Older network responses cannot overwrite newer local state.

Pending saves are flushed before switching workflows, sending Agent messages, deleting the active workflow, or starting a run.

## Node Catalog

The Add node menu has a fixed category order:

```text
Annotate → Input → 2D → 3D → Output → Video
```

Empty categories are not rendered. `Video` is reserved and currently has no nodes.

Hidden nodes remain valid definitions so older persisted workflows can still load, but they are excluded from both the full Add node menu and connection-derived compatible-node menus.

| Category | Type | Label | Inputs | Output | Menu |
| --- | --- | --- | --- | --- | --- |
| Annotate | `frame` | Frame | None | None | Visible |
| Annotate | `review` | Check | Image | Image | Visible |
| Input | `reference-image` | Image Upload | None | Image | Visible |
| Input | `prompt` | Text Prompt | None | Text | Visible |
| 2D | `generate-image` | Gen Image | Image, text | Image | Visible |
| 2D | `generate-multiview-images` | Generate Multi-view Images | Image, text | Image views | Visible |
| 3D | `generate-model` | Gen HD Model | Image, text | Model | Visible |
| 3D | `smart-mesh` | Smart Mesh | Image, text | Model | Visible |
| 3D | `multiview-to-3d` | Multi-view to 3D | Front, back, left, right images | Model | Visible |
| 3D | `text-to-3d` | Text to 3D | Text | Model | Hidden legacy type |
| 3D | `retopology` | Retopology | Model | Model | Visible |
| 3D | `bake` | Bake | Model A, model B | Model | Visible |
| 3D | `texture` | UV Texture | Model, image, text | Model | Visible |
| 3D | `rigging` | Rigging | Model | Model | Visible |
| 3D | `split` | Split | Model | Model | Visible |
| 3D | `model-preview` | Model preview | Model | Model | Visible |
| Output | `generated-image` | Image | Image | Image | Hidden compatibility type |
| Output | `export-model` | Export | Image, model | None | Visible |

`Export` belongs to the `Output` category. The generic generated `Image` node is intentionally hidden from Add node while remaining loadable.

### Runtime Port Model

The catalog describes semantic input types, but the current rendered canvas intentionally collapses them:

- Every node with at least one input receives one handle: `{ id: "input", type: "any" }`.
- Every producing node receives one handle: `{ id: "output", type: <result type> }`.
- Multi-view, Bake, and Texture therefore render a single universal input/output handle rather than every conceptual port.
- Multiple upstream edges may target the same universal input handle.
- Connection validation checks handle existence, missing nodes, self-connections, and exact duplicate edges; it does not currently enforce image/text/model type compatibility.

Persisted legacy handle names such as `front`, `back`, `model-a`, `image`, or `text` are normalized to `output → input` during loading. Multiple legacy edges between the same source and target may collapse to one edge.

This distinction is important when reproducing the current UI: implement the conceptual catalog and the universal rendered handle model separately.

## Node UI And Parameters

Normal nodes share a common card structure:

- Input handle.
- Node kind and runtime status.
- Editable title.
- Result preview or execution state.
- Type-specific controls.
- Generate/regenerate action.
- Run downstream action.
- Optional Open in Model Editor action.
- Run duration/error details.
- Output handle and downstream `+` action.

Double-click a node title to rename it. Node run status takes precedence over static node state and supports `ready`, `queued`, `running`, `succeeded`, `failed`, and `waiting_review`.

### Default Configuration Catalog

#### `reference-image`

```json
{
  "sourceType": "Upload",
  "reference": "",
  "background": "Keep",
  "preview": "/shark-reference.png"
}
```

- Source: `Upload`, `Asset Library`, `URL`.
- Background: `Keep`, `Remove`.
- Reference is currently a text field; the node itself does not upload a binary file.

#### `prompt`

```json
{
  "prompt": "Production-ready stylized 3D asset",
  "strength": 80
}
```

- Strength range: `0-100`, step `1`, displayed as `%`.

#### `generate-image`

```json
{
  "model": "GPT Image 2",
  "count": 4,
  "aspectRatio": "1:1",
  "referenceMode": "Image + Prompt",
  "previews": [
    "/shark-concept-front.png",
    "/shark-concept-left.png",
    "/shark-concept-right.png",
    "/shark-concept-back.png"
  ]
}
```

- Model: `GPT Image 2`, `Flux 1.1 Pro`, `Stable Diffusion 3.5`.
- Count: `1`, `2`, `4`.
- Aspect ratio: `1:1`, `4:3`, `3:4`, `16:9`.
- Reference mode: `Image + Prompt`, `Prompt only`, `Image variation`.
- Results render as selectable candidates; clicking one selects and opens it.

#### `generate-multiview-images`

```json
{
  "model": "GPT Image 2",
  "aspectRatio": "1:1",
  "referenceMode": "Image + Prompt",
  "viewPreviews": {
    "front": "/shark-concept-front.png",
    "back": "/shark-concept-back.png",
    "left": "/shark-concept-left.png",
    "right": "/shark-concept-right.png"
  }
}
```

Uses the same model, aspect ratio, and reference mode choices as Gen Image. Results are shown in front/back/left/right order.

#### `review`

```json
{
  "instruction": "Review the generated image before continuing.",
  "preview": "/shark-concept-front.png",
  "approved": false
}
```

The preview prefers an upstream image, then the latest run output, then local config. Toggling from unapproved to approved automatically runs downstream nodes.

#### `generate-model`, `multiview-to-3d`, and legacy `text-to-3d`

```json
{
  "modelVersion": "Smart Mesh",
  "textureMode": "PBR",
  "faceType": "Triangle",
  "faceCount": 20000,
  "preview": "/shark-model.png"
}
```

- Model version: `Smart Mesh`, `v2.5`, `v2.0`.
- Texture: `None`, `HD`, `PBR`.
- Face type: `Triangle`, `Quad`.
- Face count: `1000-50000`, step `1000`.

Legacy `quality` and boolean `texture` fields are normalized. Legacy `text-to-3d` nodes are migrated to `generate-model` when loaded.

#### `smart-mesh`

```json
{
  "faceType": "Triangle",
  "faceCount": 20000,
  "textureQuality": "No texture",
  "pbr": true,
  "preview": "/shark-model.png"
}
```

- Face type: `Triangle`, `Quad`.
- Face count: `1000-50000`, step `1000`.
- Texture quality: `No texture`, `2K`, `4K`, `8K`.
- Generate PBR maps: boolean.

#### `retopology`

```json
{
  "modelVersion": "v2.0",
  "faceType": "Triangle",
  "faceLimit": 10000,
  "bakeTextures": true,
  "preview": "/shark-retopology.png"
}
```

- Model version: `v2.0`, `v1.0`.
- Face type: `Triangle`, `Quad`.
- Face limit: `500-20000`, step `500`.
- Bake textures: boolean.
- Legacy `targetFaces` maps to `faceLimit`.

#### `bake`

```json
{
  "preview": "/shark-model.png"
}
```

No editable parameters in the current card.

#### `texture`

```json
{
  "textureQuality": "2K",
  "pbr": true,
  "preview": "/shark-textured.png"
}
```

- Texture quality: `2K`, `4K`, `8K`.
- Generate PBR maps: boolean.
- Legacy `resolution`, `model`, and `style` fields are normalized or removed.

#### `rigging`

```json
{
  "preview": "/shark-model.png"
}
```

No editable parameters in the node card. The Model Editor uses a rig visualization mode.

#### `split`

```json
{
  "subdivision": "Medium",
  "complete": true,
  "preview": "/shark-model.png"
}
```

- Subdivision: `Low`, `Medium`, `High`.
- Complete parts: boolean.
- The Model Editor uses an exploded segmented-model mode.

#### `model-preview`

```json
{
  "environment": "Studio",
  "autoRotate": true,
  "wireframe": false,
  "preview": "/shark-review.png"
}
```

- Environment: `Studio`, `Outdoor`, `Neutral`.
- Auto rotate: boolean.
- Wireframe: boolean.
- Legacy `viewer: "turntable"` enables auto-rotate; legacy background config is removed.

#### `export-model`

```json
{
  "modelFormat": "GLB",
  "exportTargets": ["dcc"],
  "preview": "/shark-model.png"
}
```

- Model format: `GLB`, `OBJ`, `FBX`, `STL`.
- Export targets are an array of enabled outputs rendered as checkboxes.
- This is a terminal node and has no output handle.

#### `frame`

New toolbar frames default to:

```json
{
  "name": "New workflow frame",
  "width": 900,
  "height": 600,
  "description": ""
}
```

Frames created around a selection use `Workflow frame` as the default name.

## Frame Semantics

Frames are Vue Flow parent nodes and visual containers, not DAG stages:

- They have no input or output handles.
- Child node positions are persisted relative to the frame.
- Child nodes use parent extent and expand the parent while dragged.
- Moving a frame moves descendants through Vue Flow parent semantics.
- Resizing is enabled with a minimum size of `260 x 180`.
- Frame z-index is lower than ordinary nodes.
- Frames can contain nested frames.
- `Make as a frame` wraps selected top-level nodes while preserving absolute positions.
- `Dissolve frame` reparents children to the dissolved frame's parent or canvas while preserving absolute positions.
- `Create workflow` exports selected content as a reusable fragment, normalizing positions relative to the selection bounds.

When grouping, the frame bounds are derived from selected nodes plus visual padding. When ungrouping, descendants are processed carefully so nested coordinate systems are preserved.

## Selection, Clipboard, And Keyboard

The app-level clipboard stores a normalized snapshot of selected nodes and internal edges. Paste:

- Generates new IDs.
- Offsets nodes from the source position or targets the canvas context-menu position.
- Reconstructs parent/child relationships.
- Rewrites edges to the new node IDs.
- Selects the pasted nodes.
- Persists the result.

Copy/paste works between workflows during the same browser session.

Supported shortcuts include:

| Shortcut | Action |
| --- | --- |
| `/` | Open Add node at the viewport center |
| `Cmd/Ctrl+A` | Select all nodes |
| `Cmd/Ctrl+C` | Copy selected nodes |
| `Cmd/Ctrl+V` | Paste |
| `Cmd/Ctrl+D` | Duplicate selected nodes |
| `Delete` / `Backspace` | Delete selected nodes or selected edges |
| `Escape` | Close menus and previews or cancel current UI state |

Shortcuts are ignored while typing into inputs, textareas, selects, buttons, or contenteditable regions.

## Automatic Layout

`src/workflow-layout.js` uses ELK's layered algorithm.

The layout preserves frame hierarchy by building a compound graph:

- Root nodes become root ELK children.
- Frame children become nested ELK children.
- DAG edges are translated to ELK edges.
- Result coordinates are written back relative to each parent.
- Frame dimensions are updated from the ELK result.
- Layout changes are persisted.

When an Agent emits `workflow-updated` with `structure_changed: true`, the frontend refreshes the authoritative workflow, automatically lays it out, and saves the resulting positions.

## Mock Workflow Execution

Agent tools modify the workflow definition; execution is a separate simulated system.

The UI can run:

- A single node: `scope: "node"` with `targetNodeId`.
- A target node and every reachable downstream node: `scope: "downstream"`.
- The whole workflow: `scope: "node"` without a target, despite the historical scope name.

The server:

1. Creates a run tied to the current workflow revision.
2. Selects the requested subgraph.
3. Traverses it topologically.
4. Marks nodes queued/running/succeeded/failed.
5. Waits roughly 600 ms per node.
6. Produces deterministic preview/output metadata.
7. Persists each transition.

Set `node.config.mockFailure` to exercise failure UI. Failed nodes stop downstream progress. The frontend polls the run endpoint until a terminal state and merges per-node status into the canvas.

The latest persisted run state is restored when a workflow opens, but only when the run revision matches the current workflow revision and the referenced node still exists.

## Model Editor

Successful model-producing nodes expose `Open in Model Editor`. The editor is a separate workspace with:

- Return-to-workflow navigation.
- Scene controls and model display.
- Standard model mode.
- Rigging overlay mode for rigging results.
- Exploded segmented-model mode for split results.
- Sample GLB assets from `public/models/`.

The current editor is a visualization demo, not a persistent mesh-editing backend. Returning to the workflow triggers a canvas fit.

## Domain Data Model

### Workflow

```json
{
  "schemaVersion": "1.0",
  "id": "wf-example",
  "name": "Stylized Character Pipeline",
  "description": "Generate and prepare a production model.",
  "revision": 3,
  "createdAt": "2026-07-27T10:00:00.000Z",
  "updatedAt": "2026-07-27T10:05:00.000Z",
  "nodes": [],
  "edges": [],
  "viewport": { "x": 80, "y": 160, "zoom": 0.72 }
}
```

### Node

```json
{
  "id": "retopology",
  "type": "retopology",
  "name": "Retopology",
  "config": {
    "faceLimit": 10000,
    "faceType": "Triangle",
    "bakeTextures": true
  },
  "ui": {
    "position": { "x": 420, "y": 140 },
    "parentId": "frame-main",
    "width": 320,
    "height": 520
  }
}
```

`config` is domain-specific. `ui` contains renderer-independent position, optional frame parent, and optional dimensions.

### Edge

```json
{
  "id": "edge-model-retopology",
  "source": { "nodeId": "generate-model", "port": "output" },
  "target": { "nodeId": "retopology", "port": "input" }
}
```

The persisted edge shape remains semantic and does not persist Vue Flow's complete internal edge object.

### Conversation

```json
{
  "id": "conv-example",
  "workflowId": "wf-example",
  "createdAt": "2026-07-27T10:00:00.000Z",
  "updatedAt": "2026-07-27T10:05:00.000Z",
  "messages": [
    {
      "id": "msg-example",
      "role": "assistant",
      "content": "Describe the workflow you want to build.",
      "createdAt": "2026-07-27T10:00:00.000Z"
    }
  ]
}
```

### Agent Task

Tasks persist queued, active, waiting, successful, and failed Agent turns. Important fields include:

```json
{
  "id": "task-example",
  "threadId": "conv-example",
  "workflowId": "wf-example",
  "message": "Add retopology and export",
  "status": "waiting_for_user",
  "progress": [],
  "eventId": 4,
  "request": {
    "request_id": "request-example",
    "prompt": "Choose an export format",
    "options": [
      { "id": "glb", "label": "GLB" },
      { "id": "fbx", "label": "FBX" }
    ],
    "min": 1,
    "max": 1
  },
  "createdAt": "2026-07-27T10:00:00.000Z",
  "updatedAt": "2026-07-27T10:00:03.000Z"
}
```

### Run

```json
{
  "id": "run-example",
  "workflowId": "wf-example",
  "workflowRevision": 3,
  "status": "running",
  "createdAt": "2026-07-27T10:00:00.000Z",
  "completedAt": null,
  "nodeRuns": {
    "retopology": {
      "status": "running",
      "durationMs": null,
      "output": null,
      "error": null
    }
  }
}
```

## Agent Architecture

There are two Agent execution paths.

### Pi Agent Service Path

This is the default local development topology:

```text
Vue app :5175
  → Vite /api proxy
Node API :8787
  → NDJSON over HTTP
Pi Agent Service :8788
  → OpenAI-compatible chat completions
DeepSeek API
```

The Agent Service is a separate Node process because the Pi packages use Node built-ins that are unavailable in a standard Cloudflare Workers runtime.

### Direct DeepSeek Path

Set:

```bash
AGENT_SERVICE_URL=direct
```

The Node API then runs the custom DeepSeek tool-call loop in-process. Cloudflare Worker deployments also use this path when `AGENT_SERVICE_URL` is not configured.

The two paths are intentionally similar but not identical:

- Direct DeepSeek uses up to the latest 20 conversation messages.
- The current Pi Agent Service request does not forward conversation history; it receives the current request and workflow.
- Direct mode defaults to `deepseek-v4-flash` when no model is supplied by its caller.
- Agent Service mode defaults to `deepseek-chat`.
- Pi progress labels are prefixed with `Pi ·`.
- Local Pi runs support in-memory steering by workflow.

## Agent Tools

The Agent has six validated tools. Tool calls are server-side only; the browser receives safe progress summaries and an authoritative workflow invalidation event.

| Tool | Purpose |
| --- | --- |
| `get_workflow_structure` | Inspect current nodes, edges, and available stage types. |
| `build_workflow` | Rebuild the complete graph from an ordered stage list, with a generated frame, placement, and compatible edges. |
| `get_workflow_parameters` | Inspect adjustable parameters for nodes currently in the workflow. |
| `update_node_parameters` | Validate and update canonical parameters on one exact node ID. |
| `add_workflow_stage` | Add one supported stage or a separate frame. |
| `request_user_select` | Pause the turn and request a finite user choice. |

### Available Agent Stage Types

```text
reference-image
prompt
generate-image
generate-multiview-images
generate-model
smart-mesh
multiview-to-3d
review
text-to-3d
retopology
bake
texture
rigging
split
model-preview
export-model
```

`frame` can be added separately but is not supplied as a `build_workflow` stage. Duplicate stage types in a build request are de-duplicated.

### `get_workflow_structure`

Input:

```json
{}
```

Returns current `{ id, type, name }` nodes, edges, and all available stage types. Extra properties are rejected.

### `build_workflow`

Input:

```json
{
  "stages": [
    "reference-image",
    "generate-multiview-images",
    "multiview-to-3d",
    "export-model"
  ]
}
```

The list must be non-empty and contain supported non-frame stages. The planner creates a frame, creates default-configured nodes, places them, connects adjacent compatible stages, increments the workflow revision, and returns the new frame ID, node summaries, and edges.

### `get_workflow_parameters`

Input:

```json
{}
```

Returns current node summaries and a human-readable parameter description. It describes only nodes currently present, not the complete catalog.

### `update_node_parameters`

Input:

```json
{
  "nodeId": "generate-model",
  "parameters": {
    "faceCount": 12000,
    "textureMode": "PBR"
  }
}
```

Rules:

- `nodeId` must be the exact existing ID, not a display label or type.
- Unknown fields are rejected.
- Number ranges and step sizes are validated.
- Boolean and string types are validated.
- Enum matching is case-insensitive and normalized to canonical values.
- Array values are restricted to allowed values and de-duplicated.
- Unchanged values do not create change records.
- Group changes for one node into one call; use separate calls for different nodes.

### `add_workflow_stage`

Input:

```json
{
  "type": "retopology"
}
```

Normal stage types are not duplicated. A new stage is inserted before `export-model` or `model-preview` where applicable, edges are rebuilt, and frame bounds are updated. `review` is inserted before the model-generation stage. Frames can be added repeatedly as independent containers.

### `request_user_select`

Input:

```json
{
  "prompt": "Choose a model version",
  "options": [
    { "id": "v2", "label": "v2.0" },
    { "id": "v25", "label": "v2.5" }
  ],
  "min": 1,
  "max": 1
}
```

Option IDs must be unique, the option list must be non-empty, and `1 <= min <= max <= options.length`. The task becomes `waiting_for_user`, persists the request, emits the selection event, and closes the current stream.

## Agent SSE Protocol

The browser opens the stream with `fetch`, not `EventSource`, because the request is a POST:

```http
POST /api/chat
Accept: text/event-stream
Content-Type: application/json

{
  "workflowId": "wf-example",
  "message": "Add retopology and export"
}
```

Response headers:

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
```

Every SSE frame has a transport event name, a JSON business payload, and a transport ID:

```text
event: message
data: {"type":"progress","thread_id":"conv-example","turn_id":"task-example","step_id":"progress-1","label":"Building workflow","status":"running"}
id: 2-0

```

- Normal business events use `event: message`.
- Failures use `event: error`.
- The business event type is always `data.type`.
- Every payload contains `thread_id` and `turn_id`.
- SSE `id:` is `<task.eventId>-0` and is not the same as a chat message's JSON `id`.
- Final assistant text is sent as one complete event, not token deltas.
- Event replay using `Last-Event-ID` is not implemented.

### Business Events

| `data.type` | Important fields | Frontend behavior |
| --- | --- | --- |
| `task-start` | `workflow_id` | Bind the server task ID to the optimistic assistant message. |
| `progress` | `step_id`, `label`, `status` | Append safe visible Agent activity. |
| `request_user_select` | `request` | Stop pending state and render a choice card. |
| `text` | `step_id`, `id`, `text` | Replace pending text with the complete assistant reply. |
| `workflow-updated` | `workflow_id`, `changed_node_ids`, `structure_changed` | Fetch authoritative workflow state; auto-layout if structure changed. |
| `finish` | `finish_reason: "stop"` | End pending state. |
| `error` | `error` | Mark the turn failed and show the message. |

Successful sequence:

```text
task-start
progress × N
text
workflow-updated
finish
```

Selection sequence:

```text
task-start
progress × N
request_user_select
stream closes
```

Failure sequence:

```text
task-start
progress × N
error
```

The workflow itself is never embedded in `workflow-updated`. The event is an invalidation signal; the frontend calls `GET /api/workflows/:id` and replaces local state with the persisted document.

### Continuing A Selection

```http
POST /api/tasks/:taskId/continue
Accept: text/event-stream
Content-Type: application/json

{
  "request_id": "request-example",
  "selected_option_ids": ["glb"]
}
```

The server validates task state, request ID, unique options, allowed option IDs, and min/max selection count. It persists the answer, adds a user conversation message containing selected labels, returns the task to `queued`, and starts a fresh Agent call using the original request plus the selection.

Submitting the exact same request ID and ordered selection again is idempotent. A conflicting second answer returns `409`.

## Pi Agent Service NDJSON Protocol

The API server calls the separate Agent Service with:

```http
POST http://127.0.0.1:8788/agent
Content-Type: application/json
```

```json
{
  "apiKey": "...",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-chat",
  "message": "Build a 3D workflow",
  "workflow": {}
}
```

The response is newline-delimited JSON with content type `application/x-ndjson`:

```json
{"type":"progress","event":{"label":"Pi · Reviewing your request","status":"running"}}
{"type":"result","plan":{"workflow":{},"reply":"Workflow updated.","changedNodeIds":[],"structureChanged":false}}
```

Message types are:

- `progress`: visible activity event.
- `result`: final Agent plan or selection request.
- `steered`: the message was added to an already active run.
- `error`: service-level failure encoded in the NDJSON body.

The service also exposes:

```http
GET /health
```

```json
{ "ok": true }
```

The `/agent` endpoint currently has no authentication and receives the DeepSeek key in its body. Keep it on a trusted local/private network or add authentication before exposing it publicly.

## HTTP API

### Workflows

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/workflows` | List summaries with `nodeCount` and `edgeCount`. |
| `POST` | `/api/workflows` | Validate and create a workflow and initial conversation. |
| `GET` | `/api/workflows/:id` | Return workflow, conversation, and latest compatible node-run state. |
| `PUT` | `/api/workflows/:id` | Replace the persisted workflow and update `updatedAt`. |
| `DELETE` | `/api/workflows/:id` | Delete workflow and associated state. |
| `POST` | `/api/workflows/:id/duplicate` | Deep-copy a workflow into revision 1. |

Creation requires a non-empty name, unique node IDs, finite node positions, valid edge objects, and edges whose endpoint nodes exist inside the workflow. The server creates `schemaVersion`, ID, timestamps, revision, and a default viewport if absent.

`PUT` is a whole-document replacement rather than a validated PATCH. The path ID and `updatedAt` are forced by the server, but most other fields are trusted. Clients should send the complete valid workflow document.

### Runs

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/workflows/:id/runs` | Start a whole, node, or downstream mock run. |
| `GET` | `/api/workflows/:id/runs/:runId` | Poll run and per-node status. |

Start payload:

```json
{
  "targetNodeId": "retopology",
  "scope": "downstream"
}
```

### Chat And Tasks

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/chat` | Create an Agent task; returns SSE when requested or `202` JSON otherwise. |
| `GET` | `/api/tasks/:id` | Retrieve one task. |
| `GET` | `/api/tasks` | Filter tasks by `workflowId` and comma-separated `status`. |
| `POST` | `/api/tasks/:id/continue` | Validate a selection and resume a waiting task. |

If `/api/chat` omits `workflowId`, the server creates an empty `New workflow`. A missing API key returns `503`; no mock chat reply is generated.

### Workflow Fragments

Fragments are reusable selections exported from the canvas.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/fragments` | List fragment summaries. |
| `POST` | `/api/fragments` | Validate and create a fragment. |
| `GET` | `/api/fragments/:idOrShareId` | Retrieve by internal ID or share ID. |
| `DELETE` | `/api/fragments/:id` | Delete by internal ID. |

Fragment shape:

```json
{
  "schemaVersion": "1.0",
  "kind": "workflow-fragment",
  "name": "Model finishing",
  "description": "Reusable finishing stages",
  "source": { "workflowId": "wf-example", "revision": 3 },
  "nodes": [],
  "edges": [],
  "interface": {
    "inputs": [{ "nodeId": "retopology", "port": "input" }],
    "outputs": [{ "nodeId": "texture", "port": "output" }]
  }
}
```

The server generates `frag-*` ID, a 16-character share ID, and timestamps. Nodes must be non-empty and unique; edges and interface endpoints must remain inside the fragment.

## Persistence

The application persists five collections:

```text
workflows
conversations
runs
fragments
tasks
```

### Local JSON Store

The Node server stores runtime state in `server/data/`:

```text
server/data/workflows/<workflow-id>.json
server/data/conversations.json
server/data/runs.json
server/data/fragments.json
server/data/tasks.json
```

Missing files are initialized from committed `server/seed/` examples. Workflow files are split by ID, while the remaining collections use array files.

Writes use a temporary file followed by rename and are serialized per collection, reducing partial writes and concurrent overwrite races. Runtime data is ignored by Git.

On load, old workflows are migrated:

- Retired `save-asset` nodes are removed.
- Legacy `model-preview` terminal behavior is migrated to `export-model` where applicable.
- Legacy `text-to-3d` is normalized to `generate-model` in the frontend.
- Removed background configuration is discarded.
- Edges referencing removed nodes are removed.
- Legacy ports are normalized.

### Cloudflare D1 Store

`migrations/0001_initial.sql` creates a simple collection store:

```sql
CREATE TABLE app_state (
  collection TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Each collection is serialized as JSON in one row. Worker requests load and parse the collections and batch-upsert changed state.

D1 migration initializes all collections to empty arrays. It does not import local `server/seed/` data, so a new Cloudflare deployment starts empty while a new local server starts with the sample workflow.

## Local Development

### Prerequisites

- Modern Node.js. Node 20+ is recommended; the repository does not currently enforce an `engines` version.
- Corepack or pnpm `11.16.0`.
- A DeepSeek API key for chat features.
- No API key is required for the canvas, mock execution, tests, or production build.

### Install

```bash
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
```

Set the key in `.env`:

```dotenv
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

### Start All Services

```bash
pnpm dev
```

This runs three processes:

| Service | Default URL | Configuration |
| --- | --- | --- |
| Vite web app | `http://localhost:5175` | Fixed `strictPort`; exits if occupied. |
| Node API | `http://127.0.0.1:8787` | `PORT`, default `8787`. |
| Pi Agent Service | `http://127.0.0.1:8788` | `AGENT_SERVICE_PORT`, default `8788`. |

Vite proxies `/api` to `127.0.0.1:8787` and ignores `server/data/**` in its file watcher.

### Run Services Separately

```bash
pnpm dev:web
pnpm dev:server
pnpm agent:service
```

Run the API without watch mode:

```bash
pnpm server
```

Run the API's direct DeepSeek implementation instead of Pi Agent Service:

```bash
AGENT_SERVICE_URL=direct pnpm dev:server
```

### Build And Preview

```bash
pnpm build
pnpm preview
```

Vite writes `dist/`. `public/` files are copied into the build root.

### Verification

```bash
pnpm test
pnpm typecheck
pnpm build
```

Tests use Node's built-in test runner with `tsx`. They cover workflow validation, migration, planner tools, DeepSeek tool dispatch, fragments, mock runs, node run recovery, node connections, layout, and run summaries without requiring a real DeepSeek key.

There are currently no browser E2E tests, Vue component mounting tests, Worker/D1 integration tests, visual regression tests, or deployment smoke tests. TypeScript checking includes `worker.ts` and `server/**/*.ts`; it does not fully type-check Vue SFCs, `src/**/*.js`, or `agent-service/**/*.ts`.

## Cloudflare Deployment

Production can run as one Cloudflare Worker serving both static assets and `/api/*`, with D1 persistence.

### 1. Authenticate And Create D1

```bash
npx wrangler login
npx wrangler d1 create forge3d
```

Replace the committed example `database_id` in `wrangler.toml` with the new database ID.

### 2. Apply The Remote Migration

```bash
pnpm cf:d1:migrate
```

The script applies migrations to the remote database named `forge3d`.

### 3. Set The DeepSeek Secret

```bash
npx wrangler secret put DEEPSEEK_API_KEY
```

### 4. Build And Deploy

```bash
pnpm cf:deploy
```

Deployment performs:

```text
vite build
→ dist/
→ copy the complete build to dist-cloudflare/
→ wrangler deploy
```

`wrangler.toml` uses:

```toml
main = "worker.ts"

[assets]
directory = "./dist-cloudflare"
binding = "ASSETS"
```

The current sample GLB files are copied into Worker Assets. They are approximately 3.03 MB and 12.64 MB, below the previously documented 25 MiB concern; no R2 route is required for the repository's current assets.

Run the complete release sequence:

```bash
pnpm cf:release
```

This runs tests, applies the remote D1 migration, and deploys. It does not run `pnpm typecheck`.

### Worker Agent Mode

Without `AGENT_SERVICE_URL`, the Worker executes the direct DeepSeek tool loop. An external Pi Agent Service can be configured with `AGENT_SERVICE_URL`, but it must be reachable from Cloudflare and secured before public exposure.

The Worker uses `ctx.waitUntil()` for non-streaming background Agent tasks. Its concurrency and steering behavior is not fully equivalent to the local Node server's in-memory workflow queues.

## Environment And Bindings

| Variable/binding | Default | Purpose |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | None | Required for chat. Use `.env` locally and Worker secret remotely. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | OpenAI-compatible API base. |
| `DEEPSEEK_MODEL` | `deepseek-chat` in `.env.example`; `deepseek-v4-flash` in Wrangler | Model selected by the active Agent path. |
| `PORT` | `8787` | Local Node API port. |
| `AGENT_SERVICE_PORT` | `8788` | Pi Agent Service port. |
| `AGENT_SERVICE_URL` | Set by `pnpm dev`; optional in Worker | External Agent endpoint, or `direct` in local Node API. |
| `ASSETS` | Worker binding | Serves `dist-cloudflare/`. |
| `DB` | D1 binding | Persists application collections. |

The model default is currently not unified across `.env.example`, the direct Agent, Agent Service, and Wrangler. Set `DEEPSEEK_MODEL` explicitly when exact reproducibility matters.

## Project Structure

```text
.
├── agent-service/
│   ├── run.ts                       # Pi Agent, tools, steering, DeepSeek provider
│   └── server.ts                    # /health and /agent NDJSON HTTP service
├── assets/                          # README screenshots
├── docs/
│   ├── agent-sse-data-design.md     # Detailed application SSE design notes
│   └── meshy-agent-sse-protocol.md  # Reference protocol research
├── migrations/
│   └── 0001_initial.sql             # D1 collection store schema
├── public/
│   ├── models/                      # Sample GLB and segmented GLB
│   └── shark-*.png                  # Sample node previews
├── scripts/
│   └── prepare-cloudflare-assets.mjs
├── server/
│   ├── agent-client.ts              # NDJSON Agent Service client
│   ├── deepseek.ts                  # Direct DeepSeek tool-call loop
│   ├── fragments.ts                 # Fragment validation and creation
│   ├── ids.ts                       # ID helpers
│   ├── index.ts                     # Local HTTP API, SSE, queues, task lifecycle
│   ├── mock-runs.ts                 # Topological simulated execution
│   ├── node-state.ts                # Latest per-node run recovery
│   ├── planner.ts                   # Workflow construction and stage insertion
│   ├── store.ts                     # Atomic local JSON persistence and migration
│   ├── workflow-parameters.ts       # Canonical Agent parameter catalog
│   ├── workflows.ts                 # Workflow validation, creation, duplication
│   ├── seed/                        # Committed local initial state
│   └── data/                        # Ignored runtime state
├── src/
│   ├── components/
│   │   ├── ComposerAttachment.vue   # Tiptap attachment view
│   │   ├── FrameNode.vue            # Group/frame node and resize UI
│   │   ├── Model3D.vue              # Three.js model viewer
│   │   ├── ModelEditor.vue          # Dedicated model workspace
│   │   ├── NodeSelect.vue           # Reka-based node select
│   │   ├── NodeSlider.vue           # Reka-based node slider
│   │   └── WorkflowNode.vue         # All ordinary node card variants
│   ├── editor/attachment.js         # Tiptap attachment extension
│   ├── App.vue                      # Product shell, canvas, chat, persistence orchestration
│   ├── main.js                      # Vue bootstrap and Vue Flow styles
│   ├── node-runs.js                 # Node run state merge helpers
│   ├── run-summary.js               # Footer run status summaries
│   ├── styles.css                   # Full application visual system and responsive CSS
│   ├── workflow-layout.js           # Compound ELK layout
│   └── workflow-nodes.js            # Catalog, defaults, ports, compatibility
├── worker.ts                        # Cloudflare API, D1 persistence, Assets fallback
├── index.html
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.json
├── vite.config.js
└── wrangler.toml
```

## Styling And Responsive Design

The interface uses a custom, compact production-tool visual language rather than a generic component library shell:

- DM Sans for UI text.
- IBM Plex Mono for metadata and technical labels.
- CSS custom properties for light/dark colors.
- Green workflow accent and node-specific status/accent colors.
- Tailwind v4 loaded through `@tailwindcss/vite` and CSS-first directives in `src/styles.css`.
- No separate Tailwind or PostCSS config file.
- `<model-viewer>` is configured as a Vue custom element in Vite.

Google Fonts are loaded over the network. Offline use falls back to local font stacks.

Desktop uses a 350 px chat column and flexible canvas. Smaller breakpoints collapse or rearrange the layout so the application remains usable on mobile, with touch-oriented pan behavior and constrained menus/panels.

## Static Assets

The demo relies on committed previews and model files:

```text
/shark-reference.png
/shark-concept-front.png
/shark-concept-back.png
/shark-concept-left.png
/shark-concept-right.png
/shark-model.png
/shark-retopology.png
/shark-textured.png
/shark-review.png
/models/shark-gardener.glb
/models/shark-gardener-segmented.glb
```

These are absolute root paths. The current Vite config assumes deployment at the domain root; subpath deployment requires a base-path and asset URL strategy.

## Reproduction Checklist

An independent implementation should preserve these invariants:

1. Keep workflow JSON independent from Vue Flow internals.
2. Convert domain nodes/edges to canvas objects on load and back on save.
3. Persist positions, frame relationships, dimensions, viewport, and revision.
4. Serialize autosaves so stale requests cannot overwrite recent edits.
5. Make server state authoritative after every Agent mutation.
6. Use POST + fetch streaming for SSE, not `EventSource`.
7. Send full final assistant messages, not token deltas.
8. Keep raw Agent tool calls private; expose only safe progress labels.
9. Pause finite decisions as persisted `waiting_for_user` tasks.
10. Restore queued, running, and waiting tasks when reopening a workflow.
11. Keep frames out of DAG edges while preserving compound canvas layout.
12. Preserve hidden compatibility node definitions for old workflows.
13. Separate conceptual typed ports from the current universal rendered handles.
14. Run simulated nodes topologically and tie run results to workflow revisions.
15. Use the same core workflow/planner modules from Node, Worker, and Agent paths.
16. Initialize local state from seeds but remote D1 state from empty collections.
17. Serve API and SPA routes from one Worker in production, falling back to Assets for non-API requests.
18. Validate Agent parameter updates against one canonical catalog.

## Known Limitations

- Workflow execution is mocked; generated images and models are committed demo assets.
- Composer attachments are not uploaded as binary content.
- The rendered port model does not enforce image/text/model compatibility.
- Conceptual multi-input and multi-output nodes render universal handles.
- `PUT /api/workflows/:id` trusts most of the submitted document and should be treated as full replacement.
- Pi Agent Service currently does not receive persisted conversation history.
- Agent Service has no authentication and transports the API key in its private request body.
- Worker concurrency and steering are not fully equivalent to the local Node API.
- D1 stores each collection as one JSON value; it is simple but not suitable for large-scale concurrent workloads.
- Remote migration does not seed the sample workflow.
- Fragment validation failures currently may surface as `500` rather than `400`.
- SSE event IDs are persisted but replay and `Last-Event-ID` recovery are not implemented.
- Local queues and active Pi runs are in memory and do not survive a Node process restart.
- No browser E2E, visual regression, Worker/D1 integration, or deployment smoke tests exist.
- Type checking does not cover the complete frontend and Agent Service.
- Static asset URLs assume root deployment.
- Google Fonts require external network access for exact typography.
- Model defaults differ across execution paths unless explicitly configured.

## Source Of Truth

When documentation and implementation diverge, use these files in this order:

1. `src/workflow-nodes.js` for visible node catalog, defaults, handles, and connection behavior.
2. `src/App.vue` for product interaction and frontend API behavior.
3. `src/components/WorkflowNode.vue` and `FrameNode.vue` for node UI.
4. `server/workflow-parameters.ts` for Agent-editable parameter validation.
5. `server/planner.ts` and `server/deepseek.ts` for Agent graph mutation semantics.
6. `server/index.ts` for local HTTP/SSE/task lifecycle.
7. `worker.ts` for production API and D1 behavior.
8. `agent-service/run.ts` and `server/agent-client.ts` for Pi/NDJSON behavior.
9. Tests for intentionally preserved edge cases and migration behavior.

The live deployment is available at <https://forge3d.lumixraku.org/>.
