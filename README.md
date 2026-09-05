# Forge3D: A Durable DeepSeek Agent Harness for Visual Workflows

[Live Demo](https://forge3d.lumixraku.org/) | [Architecture](docs/project-reference.md) | [Agent Tools](docs/canvas-tool-calls.md) | [SSE Protocol](docs/agent-sse-data-design.md) | [HTTP API](docs/api.md)

Forge3D is an open-source Agent Harness that turns natural-language intent into
an executable, versioned 3D production graph. DeepSeek does not generate a
one-shot answer: it inspects the current canvas, calls validated tools, mutates
the authoritative workflow, pauses for human decisions when necessary, and
resumes from persisted state.

The 3D canvas is the proving ground. The reusable work is the harness around it:
durable Agent turns, typed tools, checkpoints, recovery, safe event streaming,
human-in-the-loop continuation, and observable execution.

![Forge3D Canvas Studio in light mode](assets/forge3d-canvas-studio.png)

## Why This Is An Agent Harness

- **Two interchangeable DeepSeek runtimes.** Run through a standalone Pi Agent
  service or an in-process OpenAI-compatible DeepSeek tool loop against the
  same canvas tools and application protocol.
- **Durable turns, not request-scoped chat.** Sessions, messages, turns,
  progress, tool traces, checkpoints, and terminal states are persisted
  separately from the browser connection.
- **Crash-aware recovery.** The Node runtime recovers unfinished turns at
  startup. Checkpoints preserve applied canvas changes so a resumed Agent can
  continue without intentionally repeating completed work.
- **Human-in-the-loop as a protocol primitive.** `request_user_select` parks a
  turn in `waiting_for_user`; validated, idempotent continuation resumes the
  same turn rather than starting an unrelated conversation.
- **Schema-constrained action.** Seven shared tools use closed JSON Schemas and
  server-side business validation. The model never writes Vue Flow internals
  or arbitrary application state.
- **Safe, observable streaming.** One SSE channel per canvas carries correlated
  progress, selection, text, invalidation, completion, and error events. Raw
  reasoning, secrets, tool arguments, and tool outputs stay server-side.
- **Authoritative state reconciliation.** Agent events invalidate canvas state;
  clients re-fetch the persisted, revisioned document instead of trusting a
  model-generated UI patch.
- **Real asynchronous work.** The same graph runner supports mock execution and
  Tripo v3 tasks, including polling, cancellation, per-node results, durable
  asset capture, and downstream reuse of generated outputs.

## End-To-End Flow

```text
User request
  -> durable Agent turn
  -> DeepSeek / Pi Agent runtime
  -> validated canvas tools
  -> checkpoint + persisted versioned DAG
  -> canvas-scoped SSE invalidation
  -> Vue client reloads authoritative state
  -> DAG execution (mock or Tripo)
  -> durable image / model assets
```

A typical turn can inspect the graph, append an image-to-3D pipeline, ask the
user to choose an export format, resume idempotently, and then execute the
resulting DAG. The user can also edit the same document directly through the
infinite canvas; conversational and manual editing share one source of truth.

## Harness Surface

| Layer | Implementation |
| --- | --- |
| Model runtime | DeepSeek via direct tool-calling loop or standalone Pi Agent service |
| Tool contract | 7 shared tools with JSON Schema and runtime validation |
| Durable state | Canvas revisions, Sessions, Agent turns, traces, checkpoints, executions, and assets |
| Event transport | Canvas-scoped SSE with `turn_id` and `session_id` correlation |
| Human input | Persisted finite-choice requests with validated, idempotent continuation |
| Recovery | Startup recovery plus checkpoint-based continuation of interrupted turns |
| Workflow runtime | Topological node execution, cancellation, review gates, mock/Tripo providers |
| Interface | Vue 3, Vue Flow, Tiptap, Three.js, ELK layout |
| Deployment | Node runtime; Cloudflare Worker/D1 path for the runtime-compatible surface |

## Agent Tools

| Tool | Purpose |
| --- | --- |
| `get_canvas_structure` | Inspect the complete current DAG. |
| `list_available_node_types` | Discover the workflow vocabulary. |
| `build_canvas` | Append a framed, connected workflow section. |
| `get_canvas_parameters` | Inspect configurable parameters and valid values. |
| `update_node_parameters` | Apply validated changes to an exact node ID. |
| `add_canvas_node` | Insert one compatible stage into the graph. |
| `request_user_select` | Suspend the turn for a bounded user decision. |

The definitions in [`server/canvas-tools.ts`](server/canvas-tools.ts) are shared
by both Agent runtimes, preventing schema drift between orchestration paths.

## Run Locally

Requirements: Node.js 20+ and pnpm `11.16.0`.

```bash
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d postgres
pnpm dev
```

With `DATABASE_URL` set in `.env`, the Node API uses PostgreSQL and creates the
`forge3d_documents` table on startup. The first startup seeds it from
`server/seed/*.json`; subsequent startups read and write the database. Remove
`DATABASE_URL` to use the legacy file-backed store.

Set `DEEPSEEK_API_KEY` for Agent turns. Local development uses the Pi Agent
service by default; set `AGENT_SERVICE_URL=direct` to exercise the built-in
DeepSeek harness. Set `TRIPO_API_KEY` for real Tripo v3 execution or
`MESHY_API_KEY` for Meshy (the `generate-model` node); otherwise the workflow
runner uses its deterministic mock provider. The debug panel's provider
selector forces one backend when several are configured.

## Verify

```bash
pnpm test
pnpm typecheck
pnpm build
```

The test suite covers tool contracts, Agent selection and resume behavior,
trace checkpoints, service cancellation, API state transitions, execution,
persistence, Tripo integration, and durable assets.

## Engineering Notes

This repository deliberately keeps the persisted domain model independent of
Vue Flow. The server owns semantic nodes and edges, revision metadata, Agent
state, execution history, and assets; Vue Flow remains a renderer and direct
manipulation surface. That boundary makes the harness portable to other
workflow domains without coupling Agent decisions to a frontend framework.

Current constraints are documented rather than hidden: the standalone Pi path
and direct DeepSeek path have small context/model differences, SSE reconnects
reconcile from persisted state instead of replaying an event buffer, and
Cloudflare uploads require an object-storage binding before they can match the
Node asset path.

## Documentation

- [Project reference](docs/project-reference.md): complete product and
  architecture reference, data model, execution, persistence, and deployment.
- [Execution engine](docs/execution-engine.md): how a run becomes a task list,
  the scheduler loop, node-to-node handoff, failure, and review gates.
- [Canvas Agent tool calls](docs/canvas-tool-calls.md): schemas, validation rules,
  and examples for both Agent runtimes.
- [Agent SSE data design](docs/agent-sse-data-design.md): event lifecycle,
  correlation, continuation, and reconnect behavior.
- [HTTP API reference](docs/api.md): canvases, Sessions, turns, executions, SSE,
  and assets.
- [Todo](docs/todo.md): known follow-up work and limitations.

Forge3D is maintained by [@lumixraku](https://github.com/lumixraku). The project
is intentionally structured as both a working application and a reproducible
reference implementation for durable, tool-using DeepSeek Agents.
