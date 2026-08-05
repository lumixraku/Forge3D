# Agent SSE Data Design

## Overview

Server events travel on one long-lived SSE channel per canvas, not on the response of the request that started the work. `openCanvas()` in `src/composables/useCanvasDocument.ts` calls `subscribeCanvasEvents()`, which opens an `EventSource` against the Node server (`server/index.ts`) or Cloudflare Worker (`worker.ts`):

```http
GET /api/canvases/{canvasId}/events
Accept: text/event-stream
```

The response headers are:

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
```

Creating an Agent turn is a separate plain request. `sendMessage()` sends it and gets the turn back as `202` JSON; the turn's events arrive on the channel that is already open.

```http
POST /api/sessions/{sessionId}/turns
Content-Type: application/json

{"message":"将导出格式改为 STL"}
```

Each SSE frame contains a protocol event name in `event:`, a JSON business payload in `data:`, and a transport event ID in `id:`. Normal business payloads use `event: message`; failed turn payloads use `event: error`. The specific business event type is always `data.type`. Final assistant replies use one complete `text` payload rather than incremental text fragments.

```text
event: message
data: {"type":"progress","canvas_id":"canvas-8f31","session_id":"session-dba980cd","turn_id":"turn-a2b2cee2","step_id":"progress-4","label":"Updating node parameters","status":"running"}
id: 8-0

```

`event:` classifies the SSE protocol frame, while `data.type` identifies the application business event. `id:` is `<seq>-0`, where `seq` counts events per canvas; it is not the same as the JSON `id` used by `text` events to identify a chat message.

The channel also carries comment-only frames that are not events: `: subscribed` when it opens, and `: keepalive` every 15 seconds so an idle stream is not dropped by a proxy.

### Why One Channel Per Canvas Instead Of One Stream Per Turn

Because the channel belongs to the canvas rather than to a request, it is the same stream regardless of who started the work. A second client watching the same canvas sees the same events, and events that no single request owns — a node finishing, another client's turn — have somewhere to go. The cost is that a client must match each event to a chat bubble by `turn_id` rather than by which stream it arrived on, and that a turn posted against `new` has to wait for the client to subscribe to the canvas it just created (`whenSubscribed()` in `server/index.ts`).

Nothing is buffered or replayed, so `Last-Event-ID` has no effect. A reconnecting client re-reads state with `GET /api/canvases/:canvasId`, `GET /api/canvases/:canvasId/sessions`, `GET /api/sessions/:sessionId/chat-history`, and `GET /api/sessions/:sessionId/turns`, which is what opening a canvas already does.

### Canvas And Session Are Separate Resources

Sessions are subresources of the canvas, not fields on the canvas document. `GET /api/canvases/:canvasId` returns `{ canvas, nodeRuns }`; the client lists Sessions with `GET /api/canvases/:canvasId/sessions`, selects a Session, and reads its Chat History with `GET /api/sessions/:sessionId/chat-history`.

A project creates its unique canvas and an initial Session together. A canvas may have multiple Sessions. An unknown canvas returns `404`; if a canvas has no Session, the client creates one with `POST /api/canvases/:canvasId/sessions`.

## Complete Business Example: Generate Images, Then Build a Canvas

This is the intended two-turn experience. Generated Artifacts are stored directly in canvas nodes. The current implementation already emits `canvas-updated` for the frontend to fetch that authoritative canvas. `request_user_select` is the only proposed event in this example; it pauses a turn when the Agent needs a user decision.

### Turn 1: Generate Two Images

The user says: `生成两张赛博朋克鲨鱼的概念图`.

`sendMessage()` in `src/App.vue` sends:

```http
POST /api/sessions/{sessionId}/turns
Content-Type: application/json

{"message":"生成两张赛博朋克鲨鱼的概念图"}
```

The application server creates `turn-images-123`, answers `202` with it, then emits on the canvas channel:

```text
event: message
data: {"type":"turn-start","conversation_id":"conv-123","turn_id":"turn-images-123","canvas_id":"canvas-123"}
id: 1-0

event: message
data: {"type":"progress","conversation_id":"conv-123","turn_id":"turn-images-123","step_id":"step-generate-images","label":"Generating two images","status":"running"}
id: 2-0

```

The image-generation service creates two Artifacts. The application server persists their metadata in a new `generate-image` node, persists the canvas, and emits `canvas-updated`. No separate Artifact SSE event or chat gallery is needed: the canvas node is the Artifact presentation.

```text
event: message
data: {"type":"canvas-updated","conversation_id":"conv-123","turn_id":"turn-images-123","canvas_id":"canvas-123","changed_node_ids":["generate-image"],"structure_changed":true}
id: 3-0

```

On `canvas-updated`, the channel handler calls `refreshCanvas("canvas-123", "turn-images-123", true)`. `refreshCanvas()` requests `GET /api/canvases/canvas-123` and `GET /api/canvases/canvas-123/conversation` in parallel, updates the canvas and the conversation from them, then runs `autoLayout()` because a node was added.

The Agent then sends its text response and completes the first turn:

```text
event: message
data: {"type":"text","conversation_id":"conv-123","turn_id":"turn-images-123","step_id":"final-response","id":"msg-images-123","text":"已生成两张赛博朋克鲨鱼概念图，并加入画布。"}
id: 4-0

event: message
data: {"type":"finish","conversation_id":"conv-123","turn_id":"turn-images-123","finish_reason":"stop"}
id: 7-0

```

### Turn 2: Build a Canvas From the Images

The user then says: `用这两张图片制作一个带拓扑和贴图的 3D 工作流`.

The frontend sends another `POST /api/sessions/{sessionId}/turns`. The application server creates `turn-canvas-123`, reads the selected image Artifacts from the persisted canvas, builds the canvas, persists it, and emits:

```text
event: message
data: {"type":"turn-start","conversation_id":"conv-123","turn_id":"turn-canvas-123","canvas_id":"canvas-123"}
id: 1-0

event: message
data: {"type":"progress","conversation_id":"conv-123","turn_id":"turn-canvas-123","step_id":"step-build-canvas","label":"Building 3D canvas","status":"running"}
id: 2-0

event: message
data: {"type":"canvas-updated","conversation_id":"conv-123","turn_id":"turn-canvas-123","canvas_id":"canvas-123","changed_node_ids":["generate-model","retopology","texture"],"structure_changed":true}
id: 3-0

```

The frontend handles this second `canvas-updated` exactly as in turn 1: the channel handler calls `refreshCanvas()`, which fetches the persisted canvas and its conversation and redraws the canvas. The canvas now contains the image node followed by the 3D model, retopology, and UV texture nodes.

```text
event: message
data: {"type":"text","conversation_id":"conv-123","turn_id":"turn-canvas-123","step_id":"final-response","id":"msg-canvas-123","text":"已基于两张概念图创建 3D 工作流：图片输入 -> 生成模型 -> 拓扑优化 -> UV 贴图。"}
id: 4-0

event: message
data: {"type":"finish","conversation_id":"conv-123","turn_id":"turn-canvas-123","finish_reason":"stop"}
id: 7-0

```

### `request_user_select`: Selection Is Exceptional

Generating an Artifact never waits for a selection by default. Once generation succeeds, the application server writes every generated Artifact into the relevant canvas node, persists the canvas, and emits `canvas-updated`. The canvas node is the single Artifact presentation.

The application server emits `request_user_select` only when it cannot perform the next requested operation without a user decision. This event is generic: it can request a model, export, overwrite, parameter, or other business choice. Valid cases are limited to:

1. The user explicitly asks to choose, compare, approve, remove, or retry generated Artifacts.
2. The next operation accepts exactly one Artifact but multiple eligible Artifacts exist, and the user has not identified one.
3. The next operation requires a user-owned value that cannot be inferred, such as an export format, destination, or overwrite confirmation.

Example: the user says `从这两张概念图中选一张继续生成 3D 模型`, but does not identify the image. The application server persists the turn as `waiting_for_input`, then emits `request_user_select`. The Vue frontend renders a generic selection card from `options`.

```text
event: message
data: {"type":"request_user_select","conversation_id":"conv-123","turn_id":"turn-123","request":{"request_id":"request-123","prompt":"选择一张概念图继续生成 3D 模型","options":[{"id":"generate-image:front","label":"正面图"},{"id":"generate-image:side","label":"侧面图"}],"min":1,"max":1}}
id: 4-0

```

The browser must retain `turn_id` and `request_id` with the card. They identify the paused request and are required to continue the turn.

### 4. User Submits the Exceptional Selection

The Vue frontend sends the selected Artifact IDs to the application server. `idempotency_key` must remain stable across retries.

```http
POST /api/turns/turn-123/continue
Content-Type: application/json

{
  "turn_id": "turn-123",
  "request_id": "select-image-123",
  "idempotency_key": "turn-123-select-image-123",
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
data: {"type":"canvas-updated","conversation_id":"conv-123","turn_id":"turn-123","canvas_id":"canvas-123","changed_node_ids":["generate-image"],"structure_changed":false}
id: 5-0

```

After `canvas-updated`, the channel handler calls `refreshCanvas("canvas-123", "turn-123", false)`. `refreshCanvas()` requests `GET /api/canvases/canvas-123` and `GET /api/canvases/canvas-123/conversation` in parallel, then replaces the local canvas and conversation state with the persisted authoritative versions.

### 6. Agent Finishes the Turn

```text
event: message
data: {"type":"text","conversation_id":"conv-123","turn_id":"turn-123","step_id":"final-response","id":"msg-123","text":"已生成两张图片，并添加到工作流。"}
id: 8-0

event: message
data: {"type":"finish","conversation_id":"conv-123","turn_id":"turn-123","finish_reason":"stop"}
id: 11-0

```

## Event Types

Every JSON `data.type` value belongs to this list. `Implemented` means the current server emits and the current Vue frontend handles it. All business values except `error` are framed as SSE `event: message`; `error` is framed as SSE `event: error`.

Only two user actions produce events. Sending a message (`POST /api/sessions/:id/turns`) starts a turn; submitting a choice (`POST /api/turns/:id/continue`) resumes one that asked a question. Both return `202`; the events for either arrive on the canvas channel that is already open.

| Type | Status | User action behind it | Purpose |
| --- | --- | --- | --- |
| `turn-start` | Implemented | Message sent, or choice submitted. | Starts an Agent turn. A turn that asked a question emits it twice, once per action, under the same `turn_id`. |
| `progress` | Implemented | Neither; the Agent is working. | Reports user-visible execution progress. |
| `text` | Implemented | Neither; this answers the user's message. | Delivers a complete assistant message. |
| `canvas-updated` | Implemented | Neither; the message asked for canvas changes and they are persisted. | Invalidates local canvas state after server persistence. |
| `finish` | Implemented | Neither. | Marks a successful Agent turn complete. |
| `error` | Implemented | Neither; any step can fail into it. | Reports a failed Agent turn. |
| `request_user_select` | Implemented | Neither; the user's message was underspecified, so the Agent asks back. | Pauses a turn and asks the user to make a required business choice. It is not limited to Artifacts. |

### Implemented Event Details

| Type | Server emitter | Frontend receiver and action |
| --- | --- | --- |
| `turn-start` | `executeAgentTurn()` persists `running`, then emits it. No extra fields. | `applyAgentEvent()` binds `turn_id` to the optimistic assistant message that has none yet. |
| `progress` | `runDeepSeekAgent()` invokes its `onProgress` callback; `executeAgentTurn()` persists the progress item, then emits it. Fields: `step_id`, `label`, `status`. | `applyAgentEvent()` appends `{ label, status }` to the pending assistant message. |
| `text` | `executeAgentTurn()` emits it after the final assistant reply and canvas state have been persisted. Fields: `step_id`, `id`, `text`. | `applyAgentEvent()` replaces the pending assistant message content with the complete `text`. |
| `canvas-updated` | `executeAgentTurn()` first persists `canvases` and `sessions`, then emits this lightweight invalidation. Fields: `changed_node_ids`, `structure_changed`. | The channel handler calls `refreshCanvas(canvas_id, turn_id, structure_changed)`. `refreshCanvas()` calls `GET /api/canvases/:canvasId` and `GET /api/sessions/:sessionId/chat-history`, replaces frontend canvas/Session state, calls `toCanvas()`, and calls `autoLayout()` only if `structure_changed` is true. |
| `finish` | `executeAgentTurn()` emits it after `canvas-updated` when the Agent turn succeeds. Field: `finish_reason`. | `applyAgentEvent()` clears `pending` on the bubble matching `turn_id`. It does not request canvas data. |
| `error` | `executeAgentTurn()` persists the failed turn, then emits it. Field: `error`. | `applyAgentEvent()` marks the bubble matching `turn_id` failed with the error text and sets the panel error. It cannot throw into the caller of `sendMessage()`, because the event arrives on the channel rather than on that request's response. |
| `request_user_select` | `executeAgentTurn()` persists the turn as `waiting_for_user`, then emits the server-owned request. Field: `request`. | `applyAgentEvent()` stops the pending state and attaches `request` to the assistant message; the message renders a generic selection card. |

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
| `canvas_id` | Canvas the channel belongs to. |
| `session_id` | Session ID. A canvas can contain multiple Sessions, so clients use it to filter the canvas channel. |
| `turn_id` | Agent turn ID for the current user request. A client matches an event to a chat bubble by this. |

Optional fields are event-specific:

| Field | Used by | Meaning |
| --- | --- | --- |
| `step_id` | `progress`, `text` | Identifier for an Agent execution step. |
| `id` | `text` | Assistant message ID. This is not the SSE transport `id:`. |
| `label` | `progress` | User-visible Agent activity label. |
| `status` | `progress` | Currently `running` or `complete`. |
| `text` | `text` | Complete assistant message content. |
| `changed_node_ids` | `canvas-updated` | Node IDs changed by the Agent turn. |
| `structure_changed` | `canvas-updated` | Whether nodes or edges changed and auto-layout is needed. |
| `finish_reason` | `finish` | Current success value: `stop`. |
| `error` | `error` | User-visible turn failure message. |

## Event Order

Successful turns emit events in this order:

```text
turn-start
progress x N
text
canvas-updated
finish
```

Generated Artifacts are written to canvas nodes and become visible after `canvas-updated`; they do not have their own SSE event. Only a turn blocked on one of the explicit selection conditions emits `request_user_select` instead of `finish`. After `POST /api/turns/:turnId/continue`, the server resumes the turn and emits any resulting `canvas-updated`, text events, and `finish`.

Failed turns emit:

```text
turn-start
progress x N
error
```

The failed turn payload is framed as:

```text
event: error
data: {"type":"error","conversation_id":"conv-123","turn_id":"turn-123","error":"Agent turn failed"}
id: 3-0

```

`executeAgentTurn()` sends `canvas-updated` after persistence and before `finish`. The channel handler receives it and calls `refreshCanvas()` immediately, so the Vue frontend refreshes as soon as the authoritative state exists rather than at the end of the turn.

The canvas and the conversation are persisted together before the event is emitted (`server/index.ts` writes both, then emits `text`, `canvas-updated`, and `finish`), so one invalidation covers both resources and either can be read back immediately.

## Tool Call Boundary

DeepSeek tools, including `get_canvas_structure`, `list_available_node_types`, `get_canvas_parameters`, `build_canvas`, `update_node_parameters`, and `add_canvas_node`, run only between the application server and DeepSeek.

The browser receives safe `progress` labels rather than raw tool calls or raw tool outputs. In particular, `canvas-updated` is an invalidation event, not an `update_node_parameters` payload and not a full canvas document.

## User Selection Event

`request_user_select` is implemented in both `server/index.ts` and `worker.ts`. The DeepSeek tool is only used when a finite user choice is required before the turn can continue. It persists the turn as `waiting_for_user`; the generic card is restored after reload by `restoreTurns()`.

### `request_user_select`

The application server emits this when an Agent needs a user decision before it can continue. The Vue frontend renders a generic selection card.

Example: ask the user to choose an export format.

```json
{
  "type": "request_user_select",
  "session_id": "session-123",
  "turn_id": "turn-123",
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
Vue frontend
  -> GET /api/canvases/{canvasId}/events as the canvas opens, held open

User
  -> Vue frontend: POST /api/canvases/{canvasId}/turns
  -> application server: creates the turn, answers 202

Application server
   -> SSE turn-start
   -> DeepSeek: chooses generate_images tool
   -> image-generation service: creates two image Artifacts and returns URLs
   -> application server: creates a generate-image node containing both Artifacts
   -> application server: persists canvas and Session
   -> SSE canvas-updated
  -> Vue frontend: GET /api/canvases/:canvasId as authoritative reconciliation
  -> Vue frontend: GET /api/sessions/:sessionId/chat-history
   -> SSE text
  -> SSE finish
```

If the Agent needs a user choice before continuing, the sequence becomes:

```text
Application server
   -> SSE request_user_select for a required business choice
   -> Vue frontend: renders a generic selection card
   -> user selects an option and submits an answer
   -> Vue frontend: POST /api/turns/:turnId/continue
   -> application server: validates turn state, request_id, option IDs, and selection count
   -> Agent resumes and emits canvas-updated, text events, and finish
```

`POST /api/turns/:turnId/continue` accepts `request_id` and `selected_option_ids`. It persists the selection and resumes the turn with the stored Agent trace checkpoint. The checkpoint contains the working canvas, applied changes, model messages, and the next round, so completed tool work is not replayed.

## Agent Harness Trace

Each Agent turn has a persisted `agentTraces` record. It stores sanitized model requests and responses, assistant messages, tool-call lifecycle events, user-selection events, terminal status, attempt number, and a resumable checkpoint. Secrets such as API keys and authorization values are redacted and large values are bounded.

The trace can be read with `GET /api/turns/:turnId/trace` and incrementally read with `?after=<event sequence>`. Queued and interrupted running turns are recovered on the first API request after a Node process restart; interrupted turns are re-queued and marked with a recovery event. Cloudflare Worker state remains D1-backed, but exact in-flight execution ownership across isolate eviction still requires a Durable Object.

The offline fixture suite runs with `pnpm agent:eval`. It uses fixed model responses and asserts the resulting canvas DAG, parameter changes, trace events, secret redaction, and checkpoints without calling DeepSeek or consuming credits.

## Recovery

Turns and progress are persisted. `openCanvas()` in `src/composables/useCanvasDocument.ts` loads the canvas document, lists and loads a Session, restores active turns, subscribes to the canvas channel, and performs a final Session reconciliation because SSE does not replay events:

```http
GET /api/canvases/{canvasId}
GET /api/canvases/{canvasId}/sessions
GET /api/sessions/{sessionId}/chat-history
GET /api/sessions/{sessionId}/turns?status=queued,running,waiting_for_user
GET /api/canvases/{canvasId}/events
GET /api/sessions/{sessionId}/chat-history
GET /api/sessions/{sessionId}/turns?status=queued,running,waiting_for_user
```

`loadSessions()` restores settled message history. `restoreTurns()` covers only what the history cannot: turns that have not finished yet, rebuilt as a pending bubble (`queued`/`running`) or a selection card (`waiting_for_user`). After `subscribeCanvasEvents()` opens the channel, the final reconciliation closes the no-replay gap between the first REST reads and the subscription.
