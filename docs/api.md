# API Reference

> This is the HTTP API reference. See the [project reference](project-reference.md)
> for product and architecture context.

本文档以当前代码实现为准，记录仓库提供的 HTTP API。主实现位于 `server/index.ts`；Cloudflare Worker 实现位于 `worker.ts`；内部 Pi Agent 服务位于 `agent-service/server.ts`。

## 实现范围

- 本地 Node API：默认监听 `http://127.0.0.1:8787`，实现最完整。
- Cloudflare Worker：处理 `/api/*`，其他请求交给静态资源绑定 `ASSETS`。
- Pi Agent Service：默认监听 `http://127.0.0.1:8788`，供 Node API/Worker 内部调用，不应直接暴露到公网。
- 所有 JSON 错误通常为 `{ "error": "message" }`。
- 未匹配的 API 路由返回 `404`。

## API 总览

| Method | Path | Node | Worker | 说明 |
| --- | --- | :---: | :---: | --- |
| `GET` | `/api/capabilities` | 是 | 否 | 查询可用执行 provider。 |
| `GET` | `/api/projects` | 是 | 是 | 查询项目摘要列表。 |
| `POST` | `/api/projects` | 是 | 是 | 创建项目、唯一画布及一个初始 Session。 |
| `GET` | `/api/projects/:id` | 是 | 是 | 查询项目基本信息。 |
| `PATCH` | `/api/projects/:id` | 是 | 是 | 更新项目名称或描述。 |
| `DELETE` | `/api/projects/:id` | 是 | 是 | 删除项目及全部关联数据。 |
| `POST` | `/api/projects/:id/duplicate` | 是 | 是 | 复制项目及其唯一画布。 |
| `GET` | `/api/canvases/:id` | 是 | 是 | 查询画布及最新节点运行状态。 |
| `PUT` | `/api/canvases/:id` | 是 | 是 | 整体替换画布。 |
| `GET` | `/api/canvases/:id/sessions` | 是 | 是 | 查询画布的 Sessions。 |
| `POST` | `/api/canvases/:id/sessions` | 是 | 是 | 在画布中新建一个空 Session。 |
| `GET` | `/api/sessions/:id/chat-history` | 是 | 是 | 查询一个 Session 的完整 Chat History。 |
| `GET` | `/api/canvases/:id/events` | 是 | 是 | 订阅画布 SSE 事件。 |
| `GET` | `/api/sessions/:id/turns` | 是 | 是 | 查询 Session 的 Agent turns。 |
| `POST` | `/api/sessions/:id/turns` | 是 | 是 | 在 Session 中创建 Agent turn。 |
| `POST` | `/api/turns/:id/continue` | 是 | 是 | 提交 Agent 选择并继续。 |
| `GET` | `/api/canvases/:id/assets` | 是 | 是 | 查询画布历史执行资产。 |
| `GET` | `/api/assets/:file` | 是 | 否 | 读取本地持久化的 Tripo 资产。 |
| `POST` | `/api/nodes/:nodeId/executions` | 是 | 是 | 创建节点执行。 |
| `GET` | `/api/executions/:executionId` | 是 | 是 | 查询执行状态。 |

## Capabilities

### `GET /api/capabilities`

仅 Node API 实现。返回当前服务可执行的 provider：

```json
{
  "providers": { "mock": true, "tripo": true },
  "defaultProvider": "tripo",
  "tripoNodeTypes": [
    "generate-model",
    "retopology",
    "texture",
    "segments",
    "rigging",
    "export-model"
  ]
}
```

未配置 `TRIPO_API_KEY` 时，`providers.tripo` 为 `false`，默认 provider 为 `mock`。

实现：`server/index.ts` 的 capabilities 路由。

## Projects

项目与其唯一画布共享同一个对外 ID。项目生命周期和基本信息走 `/api/projects`；画布整图、Sessions、事件、资产与执行使用各自资源路径。

### `GET /api/projects`

返回项目摘要数组，字段为 `id`、`name`、`description`、`revision`、`createdAt`、`updatedAt`、`nodeCount` 和 `edgeCount`。

成功：`200`。

实现：`server/index.ts`、`worker.ts` 的 projects 路由。

### `POST /api/projects`

创建项目，同时创建其唯一画布和一个持久化 initial Session。

请求体至少需要非空 `name`，通常还传入 `nodes`、`edges` 和可选 `viewport`。创建逻辑会校验节点 ID、位置和边引用，并生成 ID、时间戳、revision 等服务端字段。

```json
{
  "name": "Character workflow",
  "nodes": [],
  "edges": [],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

成功：`201`，响应为项目摘要。随后使用相同 ID 调用 `GET /api/canvases/:id` 读取整图。

实现：`server/index.ts`、`worker.ts` 的 projects 路由；校验与默认值见 `server/canvases.ts`。

### `GET /api/projects/:id`

返回项目基本信息及 `nodeCount`、`edgeCount`，不返回整图；项目不存在返回 `404`。

### `PATCH /api/projects/:id`

更新可选的 `name` 和 `description`。`name` 提供时必须是非空字符串；项目不存在返回 `404`。

### `DELETE /api/projects/:id`

删除项目、唯一画布、Sessions、runs 和全部 turns。Node 版本同时删除画布文件。成功返回 `204`；项目不存在返回 `404`。

### `POST /api/projects/:id/duplicate`

深拷贝项目的唯一画布，生成新 ID，将名称改为 `<原名称> Copy`，revision 重置为 `1`，并创建一个独立 Session。成功返回 `201` 项目摘要。

## Canvases

### `GET /api/canvases/:id`

成功：`200`。

```json
{
  "canvas": {},
  "nodeRuns": {}
}
```

`nodeRuns` 是该画布最新兼容执行的节点状态映射。画布不存在返回 `404`。

实现：`server/index.ts`、`worker.ts` 的 canvas GET 路由。

### `PUT /api/canvases/:id`

整体替换画布图数据，不是 PATCH。服务端保留项目拥有的 `name`、`description`、`createdAt` 和路径中的 `id`，并重写 `updatedAt`；客户端应提交完整画布文档，项目基本信息改用 `PATCH /api/projects/:id`。

成功：`200`，响应为替换后的 canvas；不存在返回 `404`。

实现：`server/index.ts`、`worker.ts` 的 canvas PUT 路由。

## Sessions And Turns

### `GET /api/canvases/:id/sessions`

返回 canvas 对应的 Session 数组。项目创建和复制时创建一个默认 Session；canvas 不存在返回 `404`。

成功：`200`。

### `POST /api/canvases/:id/sessions`

在指定 canvas 下创建并持久化一个空 Session。无需请求体。canvas 不存在返回 `404`。

成功：`201`，响应为新建的 Session：

```json
{
  "id": "session-1",
  "canvasId": "canvas-1",
  "createdAt": "2026-07-31T00:00:00.000Z",
  "updatedAt": "2026-07-31T00:00:00.000Z",
  "messages": []
}
```

### `GET /api/sessions/:id/chat-history`

返回指定 Session 的完整 Chat History；Session 不存在返回 `404`。

### 打开 Canvas 并恢复聊天历史

客户端打开 Canvas 后按以下顺序恢复聊天状态：

1. 请求 `GET /api/canvases/:canvasId/sessions`，获取该 Canvas 下的 Session 列表。例如：

   ```text
   GET /api/canvases/canvas-217cd261-14c4-493b-9613-7838d86f087d/sessions
   ```

2. 选择一个 `session.id`，再请求 `GET /api/sessions/:sessionId/chat-history`，获取该 Session 的完整 Chat History。
3. 请求 `GET /api/sessions/:sessionId/turns?status=queued,running,waiting_for_user`，恢复尚未结束或正在等待用户选择的 Agent turns。
4. 最后连接 `GET /api/canvases/:canvasId/events` 接收后续实时事件。SSE 不缓存、不重放历史消息，不能替代前述 REST 请求。

### `GET /api/sessions/:id/turns`

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `status` | string | 否 | 逗号分隔的状态列表；未传时返回该 Session 的全部 turns。 |

示例：

```text
GET /api/sessions/session-1/turns?status=queued,running,waiting_for_user
```

成功：`200`，响应为 turn 数组；Session 不存在返回 `404`。

实现：`server/index.ts`、`worker.ts` 的 turns 查询路由。

### `POST /api/sessions/:id/turns`

在已有 Session 上启动 Agent turn。必须先通过 `POST /api/projects` 创建项目，再读取其默认 Session。

请求体：

```json
{ "message": "Create a low-poly shark workflow" }
```

`message` 必须是非空字符串。成功返回 `202` 和初始 turn，初始状态为 `queued`。未配置 `DEEPSEEK_API_KEY` 返回 `503`；Session 或 canvas 不存在返回 `404`；消息无效返回 `400`。

实现：`server/index.ts`、`worker.ts` 的 turn 创建路由。

### `POST /api/turns/:id/continue`

对处于 `waiting_for_user` 状态的 turn 提交选择。

请求体：

```json
{
  "request_id": "request-...",
  "selected_option_ids": ["option-a"]
}
```

约束：

- `request_id` 必须匹配当前等待请求。
- `selected_option_ids` 必须是无重复字符串数组。
- 数量必须位于请求定义的 `min` 与 `max` 之间。
- 每个 ID 必须属于请求提供的 options。

成功返回 `202`，turn 重新进入 `queued`。重复提交完全相同的选择时幂等返回 `200`；不同的重复选择或 turn 状态不匹配返回 `409`；选择无效返回 `400`；turn 不存在返回 `404`。

实现：`server/index.ts`、`worker.ts` 的 turn continue 路由。

## SSE Events

### `GET /api/canvases/:id/events`

以 `text/event-stream` 建立一个 canvas 级长连接。连接后立即写入注释 `: subscribed`，每 15 秒发送 `: keepalive`。服务端不缓存和重放事件，`Last-Event-ID` 无效；重连后应重新读取 canvas、Sessions 和 turns。

普通事件使用 `event: message`，错误使用 `event: error`：

```text
event: message
data: {"type":"progress","canvas_id":"canvas-1","session_id":"session-1","turn_id":"turn-1","step_id":"progress-1"}
id: 1-0
```

当前会发送的业务 `data.type`：

| 类型 | 主要字段 | 说明 |
| --- | --- | --- |
| `turn-start` | 公共标识字段 | turn 开始执行。 |
| `progress` | `step_id` 及 Agent progress 字段 | Agent 中间进度。 |
| `request_user_select` | `request` | Agent 等待用户选择。 |
| `text` | `step_id`, `id`, `text` | 最终助手文本。 |
| `canvas-updated` | `changed_node_ids`, `structure_changed` | 画布失效通知，客户端应重新拉取画布。 |
| `finish` | `finish_reason` | turn 正常结束。 |
| `error` | `error` | turn 执行失败。 |

每个 JSON payload 都包含 `canvas_id`、`session_id` 和 `turn_id`。客户端只处理当前 Session 的事件。SSE transport ID 格式为 `<canvas 内递增序号>-0`，服务重启后不保证延续。

实现：`server/index.ts`、`worker.ts` 的 SSE channel 与 Agent 执行逻辑。

## Executions

### `POST /api/nodes/:nodeId/executions`

从全局唯一节点创建异步执行。

Node API 请求体：

```json
{
  "mode": "downstream",
  "provider": "tripo"
}
```

| 字段 | 必填 | 默认值 | 当前行为 |
| --- | --- | --- | --- |
| `mode` | 否 | `downstream` | 传给执行计划；通常为 `downstream` 或单节点执行模式。 |
| `provider` | 否 | 自动选择 | Node API 接受 `mock`、`tripo`；配置 Tripo 时默认 `tripo`，否则 `mock`。Worker 当前忽略该字段。 |

成功：`202`，返回 execution DTO：

```json
{
  "id": "run-...",
  "entryNodeId": "node-1",
  "canvasId": "canvas-1",
  "mode": "downstream",
  "status": "queued",
  "nodeExecutions": {}
}
```

节点不存在返回 `404`。Node API 中 provider 非法返回 `400`，要求 `tripo` 但未配置时返回 `503`。

实现：`server/index.ts`、`worker.ts` 的 execution 创建路由。

### `GET /api/executions/:executionId`

返回 execution DTO，包括整体状态和各节点执行状态/输出。执行不存在返回 `404`。

成功：`200`。

实现：`server/index.ts`、`worker.ts` 的 execution 查询路由；DTO 见 `server/executions.ts`。

## Assets

### `GET /api/canvases/:id/assets`

从历史 runs 派生该 canvas 的资产，不依赖资产生产节点当前是否仍在画布中。

查询参数：

| 参数 | 说明 |
| --- | --- |
| `kind` | 按资产类型过滤。 |
| `producerNodeId` | 按生产节点过滤。 |
| `entryNodeId` | 按执行入口节点过滤。 |
| `executionId` | 按执行 ID 过滤。 |
| `limit` | 分页大小，由 `paginateAssets` 解析。 |
| `offset` | 分页偏移，由 `paginateAssets` 解析。 |

成功：`200`：

```json
{
  "assets": [],
  "total": 0,
  "runs": []
}
```

canvas 不存在返回 `404`。

实现：`server/index.ts`、`worker.ts` 的 canvas assets 路由；分页实现见 `server/executions.ts`。

### `GET /api/assets/:file`

仅 Node API 实现。返回服务器从 Tripo 保存的内容寻址文件。文件名必须符合资产存储层允许的哈希名称，不能读取任意路径。

成功：`200`，响应是二进制，`Content-Type` 根据文件推断，并带：

```text
Cache-Control: public, max-age=31536000, immutable
```

不存在或名称无效返回 `404`。

实现：`server/index.ts` 的 assets 路由，路径安全与类型处理见 `server/tripo-assets.ts`。

## Internal Agent Service

该服务是 API 服务的内部依赖，不是浏览器公共 API。

### `GET /health`

成功：`200`。

```json
{ "ok": true }
```

### `POST /agent`

请求体：

```json
{
  "apiKey": "...",
  "baseUrl": "https://api.deepseek.com",
  "model": "...",
  "message": "...",
  "canvas": {},
  "history": []
}
```

响应 `Content-Type` 为 `application/x-ndjson`，每行一个 JSON 对象：

```json
{"type":"progress","event":{}}
{"type":"result","plan":{}}
```

也可能返回：

```json
{"type":"steered"}
{"type":"error","error":"..."}
```

同一 canvas 已有流式 run 时，新请求通过 `steer()` 注入现有 Agent，并返回 `steered`。缺少 `apiKey` 不改变 HTTP 状态，而是在 NDJSON 流中返回 `type: error`。

实现：`agent-service/server.ts:29-85`。

## Node 与 Worker 差异

当前两套实现不是完全等价：

| 差异 | Node API | Cloudflare Worker |
| --- | --- | --- |
| `/api/capabilities` | 已实现 | 未实现，返回 `404`。 |
| `/api/assets/:file` | 已实现 | 未实现，返回 `404`。 |
| execution `provider` | 校验并支持 `mock`/`tripo` | 只读取 `mode`，忽略 `provider`。 |
| 默认真实 Tripo 执行 | 配置 key 后支持 | 当前 execution 路由使用默认执行器。 |
| 删除 turns | 删除项目时删除该 canvas 的全部 turns | 删除项目时删除该 canvas 的全部 turns。 |

因此，“当前完整 API”应以 `server/index.ts` 为准；部署 Worker 前需要注意以上兼容性缺口。

## 文档覆盖情况

仓库原有文档已经记录大部分 API：

- `docs/project-reference.md`：HTTP API 主列表、执行、资产、SSE 和内部 Agent Service。
- 本文档：各路由的完整请求、响应和实现差异。
- `docs/agent-sse-data-design.md`：应用 SSE 数据设计。
- `docs/canvas-tool-calls.md`：Agent canvas tool calls，不是独立 HTTP API 契约。
- `docs/meshy-agent-sse-protocol.md`：外部 Meshy 协议调研，不是本 repo 的服务端 API。

原文档的主要问题：

- README 列出了 Node API 的完整路由，但没有醒目标出 Worker 缺少 `/api/capabilities` 和 `/api/assets/:file`。
- README 将 execution 的 `provider` 描述为通用参数，但 Worker 当前忽略它。
- README 有接口列表和部分示例，但 canvas、Session、turn 的完整 schema 主要仍由实现和持久化数据隐式定义，没有单独的 OpenAPI/JSON Schema。

## 实现索引

- Node HTTP 路由：`server/index.ts`
- Worker HTTP 路由：`worker.ts`
- Agent Service：`agent-service/server.ts:29-85`
- Canvas 创建和校验：`server/canvases.ts`
- Execution DTO/分页：`server/executions.ts`
- 资产查询：`server/run-assets.ts`
- 二进制资产安全读取：`server/tripo-assets.ts`
- 前端请求包装：`src/api.ts`
