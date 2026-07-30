# Agent SSE Data Design

## Overview

The Vue frontend in `src/App.vue` creates an Agent turn. `sendMessage()` calls `submitAgentTask()`, which sends `POST /api/chat`. When the request accepts `text/event-stream`, the Node server (`server/index.js`) or Cloudflare Worker (`worker.js`) returns an SSE stream.

```http
POST /api/chat
Accept: text/event-stream
Content-Type: application/json

{"message":"将导出格式改为 STL","canvasId":"wf-f514f70e"}
```

The response headers are:

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
```

Each SSE frame contains a protocol event name in `event:`, a JSON business payload in `data:`, and a transport event ID in `id:`. Normal business payloads use `event: message`; failed task payloads use `event: error`. The specific business event type is always `data.type`. Final assistant replies use one complete `text` payload rather than incremental text fragments.

```text
event: message
data: {"type":"progress","thread_id":"conv-dba980cd","turn_id":"task-a2b2cee2","step_id":"progress-4","label":"Updating node parameters","status":"running"}
id: 8-0

```

`event:` classifies the SSE protocol frame, while `data.type` identifies the application business event. `id:` is the transport event ID. It is not the same as the JSON `id` used by `text-*` events to identify a chat message.

### Canvas And Conversation Are Separate Resources

The conversation is a subresource of the canvas, not a field on the canvas document. `GET /api/canvases/:canvasId` returns `{ canvas, nodeRuns }`; the message history comes from `GET /api/canvases/:canvasId/conversation`. The two are fetched independently and in parallel, both when a canvas is opened and when `canvas-updated` invalidates them.

A canvas and its conversation are created and deleted together, so the split is about read paths rather than lifecycle. An unknown canvas returns `404`; a canvas whose conversation row is missing returns an empty conversation, so a missing row cannot stop the canvas from opening.

## Complete Business Example: Generate Images, Then Build a Canvas

This is the intended two-turn experience. Generated Artifacts are stored directly in canvas nodes. The current implementation already emits `canvas-updated` for the frontend to fetch that authoritative canvas. `request_user_select` is the only proposed event in this example; it pauses a turn when the Agent needs a user decision.

### Turn 1: Generate Two Images

The user says: `生成两张赛博朋克鲨鱼的概念图`.

`sendMessage()` in `src/App.vue` sends:

```http
POST /api/chat
Accept: text/event-stream
Content-Type: application/json

{"message":"生成两张赛博朋克鲨鱼的概念图","canvasId":"wf-123"}
```

The application server creates `task-images-123`, opens the SSE response, then emits:

```text
event: message
data: {"type":"task-start","thread_id":"conv-123","turn_id":"task-images-123","canvas_id":"wf-123"}
id: 1-0

event: message
data: {"type":"progress","thread_id":"conv-123","turn_id":"task-images-123","step_id":"step-generate-images","label":"Generating two images","status":"running"}
id: 2-0

```

The image-generation service creates two Artifacts. The application server persists their metadata in a new `generate-image` node, persists the canvas, and emits `canvas-updated`. No separate Artifact SSE event or chat gallery is needed: the canvas node is the Artifact presentation.

```text
event: message
data: {"type":"canvas-updated","thread_id":"conv-123","turn_id":"task-images-123","canvas_id":"wf-123","changed_node_ids":["generate-image"],"structure_changed":true}
id: 3-0

```

On `canvas-updated`, `consumeAgentStream()` calls `refreshCanvas("wf-123", "task-images-123", true)`. `refreshCanvas()` requests `GET /api/canvases/wf-123` and `GET /api/canvases/wf-123/conversation` in parallel, updates the canvas and the conversation from them, then runs `autoLayout()` because a node was added.

The Agent then sends its text response and completes the first turn:

```text
event: message
data: {"type":"text","thread_id":"conv-123","turn_id":"task-images-123","step_id":"final-response","id":"msg-images-123","text":"已生成两张赛博朋克鲨鱼概念图，并加入画布。"}
id: 4-0

event: message
data: {"type":"finish","thread_id":"conv-123","turn_id":"task-images-123","finish_reason":"stop"}
id: 7-0

```

### Turn 2: Build a Canvas From the Images

The user then says: `用这两张图片制作一个带拓扑和贴图的 3D 工作流`.

The frontend sends another `POST /api/chat` with the same `canvasId`. The application server creates `task-canvas-123`, reads the selected image Artifacts from the persisted canvas, builds the canvas, persists it, and emits:

```text
event: message
data: {"type":"task-start","thread_id":"conv-123","turn_id":"task-canvas-123","canvas_id":"wf-123"}
id: 1-0

event: message
data: {"type":"progress","thread_id":"conv-123","turn_id":"task-canvas-123","step_id":"step-build-canvas","label":"Building 3D canvas","status":"running"}
id: 2-0

event: message
data: {"type":"canvas-updated","thread_id":"conv-123","turn_id":"task-canvas-123","canvas_id":"wf-123","changed_node_ids":["generate-model","retopology","texture"],"structure_changed":true}
id: 3-0

```

The frontend handles this second `canvas-updated` exactly as in turn 1: `consumeAgentStream()` calls `refreshCanvas()`, which fetches the persisted canvas and its conversation and redraws the canvas. The canvas now contains the image node followed by the 3D model, retopology, and UV texture nodes.

```text
event: message
data: {"type":"text","thread_id":"conv-123","turn_id":"task-canvas-123","step_id":"final-response","id":"msg-canvas-123","text":"已基于两张概念图创建 3D 工作流：图片输入 -> 生成模型 -> 拓扑优化 -> UV 贴图。"}
id: 4-0

event: message
data: {"type":"finish","thread_id":"conv-123","turn_id":"task-canvas-123","finish_reason":"stop"}
id: 7-0

```

### `request_user_select`: Selection Is Exceptional

Generating an Artifact never waits for a selection by default. Once generation succeeds, the application server writes every generated Artifact into the relevant canvas node, persists the canvas, and emits `canvas-updated`. The canvas node is the single Artifact presentation.

The application server emits `request_user_select` only when it cannot perform the next requested operation without a user decision. This event is generic: it can request a model, export, overwrite, parameter, or other business choice. Valid cases are limited to:

1. The user explicitly asks to choose, compare, approve, remove, or retry generated Artifacts.
2. The next operation accepts exactly one Artifact but multiple eligible Artifacts exist, and the user has not identified one.
3. The next operation requires a user-owned value that cannot be inferred, such as an export format, destination, or overwrite confirmation.

Example: the user says `从这两张概念图中选一张继续生成 3D 模型`, but does not identify the image. The application server persists the task as `waiting_for_input`, then emits `request_user_select`. The Vue frontend renders a generic selection card from `options`.

```text
event: message
data: {"type":"request_user_select","thread_id":"conv-123","turn_id":"task-123","request":{"request_id":"request-123","prompt":"选择一张概念图继续生成 3D 模型","options":[{"id":"generate-image:front","label":"正面图"},{"id":"generate-image:side","label":"侧面图"}],"min":1,"max":1}}
id: 4-0

```

The browser must retain `turn_id` and `request_id` with the card. They identify the paused request and are required to continue the turn.

### 4. User Submits the Exceptional Selection

The Vue frontend sends the selected Artifact IDs to the application server. `idempotency_key` must remain stable across retries.

```http
POST /api/tasks/task-123/continue
Content-Type: application/json

{
  "turn_id": "task-123",
  "request_id": "select-image-123",
  "idempotency_key": "task-123-select-image-123",
  "content": {
    "selected_option_ids": ["generate-image:front"]
  },
  "dismissed": false
}
```

The application server validates and persists the answer, then resumes the Agent. The frontend updates the existing selection card locally after a successful continuation response; no second SSE event type is needed.

### 5. Server Updates the Canvas

The application server uses the selected option, updates the next canvas node, persists the canvas, and emits `canvas-updated`. The Vue frontend fetches the authoritative state and redraws the canvas.

```text
event: message
data: {"type":"canvas-updated","thread_id":"conv-123","turn_id":"task-123","canvas_id":"wf-123","changed_node_ids":["generate-image"],"structure_changed":false}
id: 5-0

```

After `canvas-updated`, `consumeAgentStream()` calls `refreshCanvas("wf-123", "task-123", false)`. `refreshCanvas()` requests `GET /api/canvases/wf-123` and `GET /api/canvases/wf-123/conversation` in parallel, then replaces the local canvas and conversation state with the persisted authoritative versions.

### 6. Agent Finishes the Turn

```text
event: message
data: {"type":"text","thread_id":"conv-123","turn_id":"task-123","step_id":"final-response","id":"msg-123","text":"已生成两张图片，并添加到工作流。"}
id: 8-0

event: message
data: {"type":"finish","thread_id":"conv-123","turn_id":"task-123","finish_reason":"stop"}
id: 11-0

```

## Event Types

Every JSON `data.type` value belongs to this list. `Implemented` means the current server emits and the current Vue frontend handles it. All business values except `error` are framed as SSE `event: message`; `error` is framed as SSE `event: error`.

| Type | Status | Purpose |
| --- | --- | --- |
| `task-start` | Implemented | Starts an Agent turn. |
| `progress` | Implemented | Reports user-visible execution progress. |
| `text` | Implemented | Delivers a complete assistant message. |
| `canvas-updated` | Implemented | Invalidates local canvas state after server persistence. |
| `finish` | Implemented | Marks a successful Agent turn complete. |
| `error` | Implemented | Reports a failed Agent turn. |
| `request_user_select` | Implemented | Pauses a turn and asks the user to make a required business choice. It is not limited to Artifacts. |

### Implemented Event Details

| Type | Server emitter | Frontend receiver and action |
| --- | --- | --- |
| `task-start` | `executeAgentTask()` persists `running`, then emits it. Fields: `canvas_id`. | `consumeAgentStream()` passes it to `applyAgentEvent()`, which binds `turn_id` to the optimistic assistant message. |
| `progress` | `runDeepSeekAgent()` invokes its `onProgress` callback; `executeAgentTask()` persists the progress item, then emits it. Fields: `step_id`, `label`, `status`. | `applyAgentEvent()` appends `{ label, status }` to the pending assistant message. |
| `text` | `executeAgentTask()` emits it after the final assistant reply and canvas state have been persisted. Fields: `step_id`, `id`, `text`. | `applyAgentEvent()` replaces the pending assistant message content with the complete `text`. |
| `canvas-updated` | `executeAgentTask()` first persists `canvases` and `conversations`, then emits this lightweight invalidation. Fields: `canvas_id`, `changed_node_ids`, `structure_changed`. | `consumeAgentStream()` calls `refreshCanvas(canvas_id, turn_id, structure_changed)`. `refreshCanvas()` calls `GET /api/canvases/:canvasId` and `GET /api/canvases/:canvasId/conversation`, replaces frontend canvas/conversation state, calls `toCanvas()`, and calls `autoLayout()` only if `structure_changed` is true. |
| `finish` | `executeAgentTask()` emits it after `canvas-updated` when the Agent turn succeeds. Field: `finish_reason`. | `applyAgentEvent()` returns the completed `turn_id`; `consumeAgentStream()` clears `pending` for that assistant message. It does not request canvas data. |
| `error` | `executeAgentTask()` persists the failed task, then emits it. Field: `error`. | `applyAgentEvent()` throws the error; `sendMessage()` marks the optimistic assistant message as failed and displays the error text. |
| `request_user_select` | `executeAgentTask()` persists the task as `waiting_for_user`, then emits the server-owned request. Field: `request`. | `applyAgentEvent()` stops the pending state and attaches `request` to the assistant message; the message renders a generic selection card. |

## `request_user_select` Fields

The following fields are used only by the implemented user-selection event. They are nested in `request`.

| Field | Used by | Meaning |
| --- | --- | --- |
| `request.request_id` | `request_user_select` | Server-owned stable ID for the paused selection request. |
| `request.prompt` | `request_user_select` | User-visible business question. |
| `request.options` | `request_user_select` | Choices the user can select. Each option has a stable `id` and display `label`. |
| `request.min`, `request.max` | `request_user_select` | Minimum and maximum number of selections. |

## Shared Fields

Every event contains these fields:

| Field | Meaning |
| --- | --- |
| `type` | One of the event types listed above. |
| `thread_id` | Conversation ID. |
| `turn_id` | Agent task ID for the current user request. |

Optional fields are event-specific:

| Field | Used by | Meaning |
| --- | --- | --- |
| `canvas_id` | `task-start`, `canvas-updated` | Canvas to synchronize. |
| `step_id` | `progress`, `text` | Identifier for an Agent execution step. |
| `id` | `text` | Assistant message ID. This is not the SSE transport `id:`. |
| `label` | `progress` | User-visible Agent activity label. |
| `status` | `progress` | Currently `running` or `complete`. |
| `text` | `text` | Complete assistant message content. |
| `changed_node_ids` | `canvas-updated` | Node IDs changed by the Agent turn. |
| `structure_changed` | `canvas-updated` | Whether nodes or edges changed and auto-layout is needed. |
| `finish_reason` | `finish` | Current success value: `stop`. |
| `error` | `error` | User-visible task failure message. |

## Event Order

Successful turns emit events in this order:

```text
task-start
progress x N
text
canvas-updated
finish
```

Generated Artifacts are written to canvas nodes and become visible after `canvas-updated`; they do not have their own SSE event. Only a task blocked on one of the explicit selection conditions emits `request_user_select` instead of `finish`. After `POST /api/tasks/:taskId/continue`, the server resumes the task and emits any resulting `canvas-updated`, text events, and `finish`.

Failed turns emit:

```text
task-start
progress x N
error
```

The failed task payload is framed as:

```text
event: error
data: {"type":"error","thread_id":"conv-123","turn_id":"task-123","error":"Agent task failed"}
id: 3-0

```

`executeAgentTask()` sends `canvas-updated` after persistence and before `finish`. `consumeAgentStream()` receives it and calls `refreshCanvas()` immediately. Therefore the Vue frontend refreshes the canvas as soon as the authoritative state is available, rather than waiting for the SSE response to close.

The canvas and the conversation are persisted together before the event is emitted (`server/index.ts` writes both, then emits `text`, `canvas-updated`, and `finish`), so one invalidation covers both resources and either can be read back immediately.

## Tool Call Boundary

DeepSeek tools, including `get_canvas_structure`, `list_available_node_types`, `get_canvas_parameters`, `build_canvas`, `update_node_parameters`, and `add_canvas_node`, run only between the application server and DeepSeek.

The browser receives safe `progress` labels rather than raw tool calls or raw tool outputs. In particular, `canvas-updated` is an invalidation event, not an `update_node_parameters` payload and not a full canvas document.

## User Selection Event

`request_user_select` is implemented in both `server/index.js` and `worker.js`. The DeepSeek tool is only used when a finite user choice is required before the task can continue. It persists the task as `waiting_for_user`; the generic card is restored after reload by `restoreAgentTasks()`.

### `request_user_select`

The application server emits this when an Agent needs a user decision before it can continue. The Vue frontend renders a generic selection card.

Example: ask the user to choose an export format.

```json
{
  "type": "request_user_select",
  "thread_id": "conv-123",
  "turn_id": "task-123",
  "request": {
    "request_id": "request-123",
    "prompt": "请选择导出格式",
    "options": [
      { "id": "glb", "label": "GLB" },
      { "id": "fbx", "label": "FBX" },
      { "id": "stl", "label": "STL" }
    ],
    "min": 1,
    "max": 1
  }
}
```

The Vue frontend retains `turn_id` and `request.request_id`; both identify the paused server-side selection request.

## Example: "帮我创建两个图片"

The desired end-to-end sequence is:

```text
User
  -> Vue frontend: POST /api/chat
  -> application server: creates task and opens SSE

Application server
   -> SSE task-start
   -> DeepSeek: chooses generate_images tool
   -> image-generation service: creates two image Artifacts and returns URLs
   -> application server: creates a generate-image node containing both Artifacts
   -> application server: persists canvas and conversation
   -> SSE canvas-updated
  -> Vue frontend: GET /api/canvases/:canvasId as authoritative reconciliation
  -> Vue frontend: GET /api/canvases/:canvasId/conversation for the message history
   -> SSE text
  -> SSE finish
```

If the Agent needs a user choice before continuing, the sequence becomes:

```text
Application server
   -> SSE request_user_select for a required business choice
   -> Vue frontend: renders a generic selection card
   -> user selects an option and submits an answer
   -> Vue frontend: POST /api/tasks/:taskId/continue
   -> application server: validates task state, request_id, option IDs, and selection count
   -> Agent resumes and emits canvas-updated, text events, and finish
```

`POST /api/tasks/:taskId/continue` accepts `request_id` and `selected_option_ids`. It persists the selection and starts a fresh DeepSeek call with the original task request plus the selected option labels, because the current DeepSeek invocation is one-shot rather than checkpoint-resumable.

## Recovery

Tasks and progress are persisted. `openCanvas()` in `src/composables/useCanvasDocument.ts` loads the canvas document, then calls `loadConversation()` and `restoreAgentTasks()` from `src/composables/useAgentChat.ts`. Opening a canvas therefore issues three requests, each for a distinct resource:

```http
GET /api/canvases/{canvasId}
GET /api/canvases/{canvasId}/conversation
GET /api/tasks?canvasId={canvasId}&status=queued,running,waiting_for_user
```

`loadConversation()` restores the settled message history. `restoreAgentTasks()` covers only what the history cannot: turns that have not finished yet, rebuilt as a pending bubble (`queued`/`running`) or a selection card (`waiting_for_user`). The live communication path remains the SSE response that `submitAgentTask()` receives from `POST /api/chat`.
