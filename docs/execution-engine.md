# Forge3D Execution Engine

> How a node run turns a DAG into a task list, executes it in dependency order,
> hands results from one node to the next, stops on failure, and pauses at a
> review gate. This is the mechanism behind the `Run` / `Run downstream` buttons
> and the "execution chain". Start with the [root README](../README.md) and the
> [project reference](project-reference.md) (Canvas Execution section) for the
> product-level view; this document is about the concrete scheduler.

## 1. Who runs what

There is **no frontend execution chain**. The client computes *which* nodes to
run and *sends the whole plan in one request*; the server owns the run record,
executes the nodes in dependency order, and the client merely polls for status.

| Role | Owner | Where |
| --- | --- | --- |
| Compute the plan (which nodes, topological order) | Frontend | `src/run-plan.ts` |
| Validate and persist the run record | Server | `server/executions.ts` `createExecution` |
| Execute the chain, wave by wave | Server | `server/executions.ts` `executeExecution` |
| Simulate node work (mock) or call Tripo | Server | `server/mock-runs.ts` / Tripo provider |
| Poll status and reflect it on the canvas | Frontend | `src/composables/useCanvasRun.ts` `pollExecution` |

The plan is recomputed on both sides. `src/run-plan.ts` and `server/mock-runs.ts`
are two implementations of the same topological sort; the server rejects a
submitted plan that does not match its own (`409`, `server/executions.ts:150`).

## 2. The plan

Only **executable** node types enter a plan — input nodes and frames carry no
work. `isExecutableNodeType` (`src/canvas-schema.ts`) decides, driven by the node
schema's `executable` flag.

`src/run-plan.ts`:

- `executionOrder(nodes, edges)` (`src/run-plan.ts:18`) — Kahn topological sort
  of the executable nodes. Nodes left unordered by a cycle fall back to
  declaration order.
- `planNodes(nodes, edges, targetNodeId, scope)` (`src/run-plan.ts:49`) —
  - `scope: 'node'` with a target → run that one node alone.
  - `scope: 'downstream'` → run the target **plus every node reachable from it**
    along the edges (a `reachable` set, then filtered in topological order).
    This is what the **Run downstream** button starts (`CanvasNode.vue:352`).
  - no target → the whole graph.

The client sends `nodeIds` (the plan) plus `parameters` (each node's `config`)
to `POST /api/projects/:canvasId/executions`, and immediately shows every planned
node as `queued` (first as `running`) so the chain is visible up front
(`useCanvasRun.ts:118-125`).

The server recomputes the same selection independently with
`executionNodes` / `downstreamCanvas` (`server/mock-runs.ts:86`, `:116`) and
checks the submitted `nodeIds` match exactly (`server/executions.ts:150`).

## 3. Data structures

Everything that makes the chain work is local to one `executeExecution` call
(`server/executions.ts:211`):

| Structure | Kind | Purpose |
| --- | --- | --- |
| `nodes` | array (topological) | the plan; the list of things to run |
| `dependencies` | `Map<nodeId, Set<nodeId>>` | the graph: each node's *upstream* ids, built from the edges (`:237-240`) |
| `completed` | `Set<nodeId>` | progress watermark: nodes that finished this run |
| `context` | `Map<nodeId, {modelUrl, preview, ports, tripoTaskId}>` | handoff of upstream output for real backends (`:221-235`) |
| `run.nodeRuns` | `Record<nodeId, NodeRun>` | the persisted task list, one entry per node: `status, durationMs, output, error, progress, tripoTaskId` |

`run.nodeRuns` is the task list the UI renders. Node statuses
(`src/node-runs.ts:4`): `queued → running → succeeded | failed | skipped | waiting_review`.

## 4. The scheduler loop

There is **no inter-node messaging** — nodes never know who their downstream is,
and downstream never polls upstream. A single `while` loop in
`executeExecution` is the only driver (`server/executions.ts:241-261`):

```js
const completed = new Set()
while (completed.size < nodes.length && !run.cancelRequested) {
  // ready = every node whose upstreams all finished
  const ready = nodes.filter((node) =>
    !completed.has(node.id) &&
    [...dependencies.get(node.id)].every((id) => completed.has(id)))
  if (!ready.length) break
  for (const node of ready) run.nodeRuns[node.id].status = 'running'
  await onUpdate()
  await Promise.all(ready.map((node) => (async () => {
    try {
      const result = await executeNode(node, executionCanvas, provider)
      if (result.status === 'succeeded') context.set(node.id, { ... })
      recordNodeExecution(runs, { ... })
    } catch (failure) {
      recordNodeExecution(runs, { ... status: 'failed', error: failure.message })
    } finally {
      completed.add(node.id)   // the only "notification"
    }
  })()))
  await onUpdate()
  if (Object.values(run.nodeRuns).some((n) => n.status === 'failed')) break
}
```

How it behaves:

- **Dependency-serial, sibling-parallel.** A chain `A→B→C→D` runs strictly one at
  a time (`Promise.all` holds a single element per wave). A fork (`A` feeding both
  `B` and `C`) runs `B` and `C` concurrently in one wave; their shared downstream
  still waits a further wave because `Promise.all` settles the whole wave first.
- **No timer.** The "next round" is immediate — the `await` resumes as soon as the
  slowest node of the wave settles, then the next `filter` runs. There is no
  per-second polling anywhere in the server scheduler.
- **The handoff is a resolved promise waking the loop**, not a node-to-node call.
  `finally { completed.add(node.id) }` is the only thing an upstream node does for
  its downstream.

After the loop:

- Nodes still `queued` become **`skipped`** (`server/executions.ts:262-264`).
- Run status is derived: `cancelled` if a cancel was requested, else `failed` if
  any node failed, else `waiting_review` if a review gate held, else `succeeded`
  (`server/executions.ts:265-268`).

## 5. How results pass between nodes

There is no direct value handoff. Each node's output is *recorded*, and the next
node *reads* what it needs when it runs:

- **Mock/simulated.** `executeNode` never reads a shared run record. Downstream
  resolves its inputs off the **saved canvas** — the upstream node's
  `generatedAssets` in `config` — via `resolveNodeInputs` (`src/canvas-nodes.ts`,
  used at `server/mock-runs.ts:26`). The client calls `saveCanvas()` alongside
  the run request for exactly this reason (`useCanvasRun.ts:145`).
- **Real Tripo.** A real result only exists once the task finishes, so the server
  threads the `context` Map through the run: each successful node writes
  `{modelUrl, preview, ports, tripoTaskId}` (`server/executions.ts:250`), and the
  provider passes the upstream `task_id` straight into the next node's input so no
  mesh is re-uploaded between stages. `context` is seeded from `latestNodeRuns`
  (`server/node-state.ts:1`) so re-running a single node still sees what earlier
  runs produced (`server/executions.ts:224-231`).

## 6. Empty inputs block execution

Two layers, both acting before anything runs:

1. **Frontend** — `missingInputsByNode` (`src/canvas-nodes.ts:319`) reports
   `required_input_missing` per node; the `Run` / `Run downstream` buttons are
   disabled with a tooltip (`CanvasNode.vue:352`).
2. **Server** — `createExecution` runs `validateCanvasGraph(nodes, edges,
   { requireInputs: planned })` (`server/executions.ts:180-185`) and throws a
   `400` if a planned node lacks a required input.

A required port is "satisfied" by an incoming edge **or** a fallback config value
(e.g. a `text-to-3d` prompt), checked the same way inputs are resolved at run
time (`src/canvas-nodes.ts:262-297`). The check is scoped to planned nodes so a
half-built node elsewhere cannot block a run.

## 7. Review gates (`waiting_review`)

A `review` node is a human checkpoint. When it executes, `server/mock-runs.ts:174`
returns `waiting_review` instead of `succeeded` if `generatedAssets.approved` is
false. This is **not a failure** — nothing is marked red.

How the gate holds:

- The run's final status becomes `waiting_review` (`server/executions.ts:267`).
- The client's poll loop only continues for `queued / running / cancelling`
  (`useCanvasRun.ts:175`), so on `waiting_review` it stops and the node renders
  "Awaiting approval" (`CanvasNode.vue:308`).
- Approval (`toggleApprove`, `CanvasNode.vue:128`) sets `approved = true` and
  **re-triggers `run-downstream`** — on the next run the review node returns
  `succeeded` and the rest of the chain proceeds.

> Nuance: the server loop only hard-breaks on `failed` (`server/executions.ts:260`),
> and a `waiting_review` node still lands in `completed`. So within a single server
> pass, nodes downstream of an unapproved review **can** still be scheduled if
> their other dependencies are satisfied. In practice the gate holds because (a)
> the review node usually sits at the end of a chain / before export, and (b) a
> real provider finds no upstream output in `context` and fails those nodes. The
> reliable gate is the run status + client polling + the mandatory re-run on
> approval. If a hard server-side break is wanted, the loop needs a
> `waiting_review` check next to the `failed` check.

## 8. Failure and cancellation

- **Failure stops downstream.** A thrown error from `executeNode` is recorded as
  `failed` (`server/executions.ts:252-254`); the loop breaks on any `failed`
  (`:260`) and everything still queued becomes `skipped` (`:262-264`). Combined
  with the `ready` predicate, a failed node's downstream never runs.
- **Cancellation.** `POST /api/executions/:id/cancel` sets `cancelRequested`
  (`server/executions.ts:98`); the loop exits at the top of the next iteration
  and the run ends `cancelled`.
- **Mock failure for testing.** `node.config.mockFailure` makes the node throw
  (`server/mock-runs.ts:158`).

## 9. Client polling

`pollExecution` (`useCanvasRun.ts:172`) polls `GET /api/executions/:id` until a
terminal state (`mock: 250ms`, `tripo: 1500ms`, `useCanvasRun.ts:9`), merging
per-node status into the canvas. On completion it also materializes generated
image batches and triggers model downloads (`useCanvasRun.ts:182-188`).

## 10. API surface

| Endpoint | Purpose |
| --- | --- |
| `POST /api/projects/:canvasId/executions` | Start a run (used by Run / Run downstream) |
| `POST /api/canvases/:canvasId/nodes/:nodeId/executions` | Node-scoped start |
| `GET /api/executions/:id` | Poll status (`executionDto`) |
| `POST /api/executions/:id/cancel` | Cancel |
| `GET /api/canvases/:canvasId/executions` | Run history |

## 11. Walkthrough: `multiview → model → export`

```text
wave 1  ready=[multiview]        completed={multiview}
wave 2  ready=[model]            completed={multiview, model}
wave 3  ready=[export]           completed={multiview, model, export}
```

Each wave's output is recorded; the export node resolves its upstream mesh from
`context` (real backend) or the saved canvas (mock), and the run ends `succeeded`.
If `model` throws, wave 2 records it `failed`, the loop breaks, and `export` is
marked `skipped` instead of running.
