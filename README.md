# Forge3D

[Live Demo](https://forge3d.lumixraku.org/) | [Design and Architecture](docs/README.md) | [Local Database](docker/README.md) | [HTTP API](docs/api.md)

Forge3D is a visual 3D canvas for AI generation workflows. Describe a goal in natural language or edit the canvas directly, then connect image input, model generation, processing, and export steps into a reusable workflow.

## Features

- Create, connect, duplicate, and organize workflow nodes on an infinite canvas.
- Configure image, model, material, format, and export parameters on each node.
- Drop local images or 3D files onto the canvas as workflow inputs.
- Ask the DeepSeek Agent to inspect the current canvas, build workflows, update parameters, and request decisions when needed.
- Run one node, a node and its downstream dependencies, or the complete workflow.
- Inspect per-node status, progress, outputs, duration, and errors.
- Use the Mock provider to explore the complete workflow without generation-service credentials.
- Use Tripo or Meshy for real image-to-3D, model processing, and related generation tasks.
- Connect generated results to downstream processing nodes and preview images and 3D models on the canvas.
- Persist canvases, sessions, executions, and Agent state so work can continue after reopening the application.
- Receive execution progress and collaboration updates over SSE; multiple browser tabs can observe the same canvas.

## Node parameters

Each node type declares its controls in `src/canvas-schema.ts`. A parameter has a stable `key`, a display `label`, a `control` (`text`, `textarea`, `select`, `segmented`, `slider`, or `toggle`), and optional `options` or `range`. Stored config stays a flat map of those keys. Hiding a control does not delete its saved value.

Cascades follow a ComfyUI DynamicCombo. The group lives on the option, in `inputs`. The selected option's inputs are drawn directly under that control, and choosing another option takes that group off the node. An input can itself be a menu or a toggle with its own options. `AI Model` → `v3.1 · Best Quality` owns Ultra Mesh Quality. `Format` → `FBX` owns FBX Preset. Meshy `Mesh Type` → `Standard` owns the standard model list, and that list's `Latest` option owns Geometry Resolution.

A toggle is the same shape with one option, `{ value: true, inputs }`. While the toggle is on, that option's group is shown. Meshy Texture owns Texture Resolution and PBR. Remesh owns Topology and Target Polycount. Hidden values stay saved.

Two related mechanisms do not hide a control:

- `range.rules` keeps the control on screen and changes its minimum or maximum when a condition matches. Quad topology, for example, lowers the polycount maximum.
- `effects` writes other config fields when a value is chosen. A write can select a different option, which swaps the group under that control.

## Ways to Run Forge3D

### Local Runtime

The local Node runtime provides the complete development and generation experience:

- DeepSeek Agent support.
- Mock, Tripo API, and Meshy API providers.
- Image and 3D file uploads.
- Binary persistence for uploaded assets and generated results in PostgreSQL.
- Local debugging, testing, and frontend or backend development.

The local service requires PostgreSQL for application data and assets. Startup stops with an actionable message when `DATABASE_URL` is missing or the database is unreachable.

### Cloudflare Web Deployment

The [live application](https://forge3d.lumixraku.org/) runs on Cloudflare Workers:

- Use the canvas, edit nodes, save workflows, manage sessions, and run the Worker-compatible Agent features in a browser.
- Application data is persisted in Cloudflare D1.
- The Mock provider is available without Tripo or Meshy credentials.
- Publicly accessible external image URLs can be displayed.
- R2 is not currently bound, so user-uploaded images and models cannot be persisted by the Worker.
- The Worker does not run the Node-only Tripo, Meshy, or local asset-storage paths.

Cloudflare D1 and local PostgreSQL are independent stores. Deploying to Cloudflare does not upload or synchronize canvases from the local PostgreSQL database.

## Prerequisites

Prepare the following configuration for the features you intend to use.

### Required Configuration

Create a `.env` file in the repository root. It supplies `DATABASE_URL` for the local runtime and, for the DeepSeek Agent, the API key:

```bash
cp .env.example .env
```

Set your DeepSeek API key:

```dotenv
DEEPSEEK_API_KEY=your_DeepSeek_API_key
```

`DEEPSEEK_BASE_URL` and `DEEPSEEK_MODEL` already have defaults and normally do not need to be changed:

```dotenv
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

You may leave `DEEPSEEK_API_KEY` empty if you only want to use the canvas and Mock workflows without the Agent.

### Local Database

PostgreSQL is required for local persistence and for the Node API to start. Start it first:

```bash
docker compose up -d postgres
```

The default connection string in `.env` matches the included Docker configuration:

```dotenv
DATABASE_URL=postgresql://forge3d:forge3d@127.0.0.1:5432/forge3d
```

The Node service applies migrations at startup. An empty database is initialized from `server/seed/`, and database data is retained in a Docker volume.

`DATABASE_URL` is required. If it is missing, or if PostgreSQL is not running, the Node API exits with a message that names the fix; it does not fall back to local JSON files.

### Optional Generation Services

Configure Tripo to enable real Tripo generation and processing nodes:

```dotenv
TRIPO_API_KEY=your_Tripo_API_key
TRIPO_BASE_URL=https://openapi.tripo3d.ai/v3
```

Configure Meshy to enable Meshy-backed nodes such as `generate-model`:

```dotenv
MESHY_API_KEY=your_Meshy_API_key
MESHY_BASE_URL=https://api.meshy.ai
```

The application still works with the Mock provider when these keys are absent. Never commit `.env` or any API key to Git.

## Run Locally

Requirements: Node.js 20+, pnpm `11.16.0`, and Docker running (or another PostgreSQL 16 instance reachable through `DATABASE_URL`).

```bash
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d postgres
pnpm dev
```

Open the local frontend URL printed in the terminal. `pnpm dev` starts the frontend, Node API, and local Agent service together, and selects available ports automatically.

`pnpm dev` exits immediately when PostgreSQL is unreachable or `DATABASE_URL` is missing, printing the command that fixes it. Run `docker compose up -d postgres` first, then retry.

Common verification commands:

```bash
pnpm test
pnpm run typecheck
pnpm run build
```

To use the built-in DeepSeek loop instead of the local Pi Agent service, set this in `.env`:

```dotenv
AGENT_SERVICE_URL=direct
```

## Deploy to Cloudflare

Cloudflare deployment uses the existing Worker, D1, and static asset configuration. Before deploying:

- Install Wrangler and authenticate with your Cloudflare account.
- Make sure the Worker name, custom domain, and D1 database in `wrangler.toml` belong to your Cloudflare account.
- Configure the `DEEPSEEK_API_KEY` Worker secret if the deployed application should use the DeepSeek Agent.
- Apply the D1 migration.

Run the complete release process:

```bash
pnpm run cf:release
```

This command runs the tests, applies remote D1 migrations, builds the frontend assets, and deploys the Worker. To run individual stages instead:

```bash
pnpm run cf:build
pnpm run cf:d1:migrate
pnpm run cf:deploy
```

Cloudflare does not use `DATABASE_URL` from the local `.env` file and cannot access a PostgreSQL server on your machine. The web deployment uses the D1 binding from `wrangler.toml`; persistent image and model uploads require a future R2 integration.

## Documentation

- [Documentation index](docs/README.md): architecture, design details, protocols, and API references.
- [Project reference](docs/project-reference.md): product capabilities, data model, runtimes, and deployment reference.
- [Execution engine](docs/execution-engine.md): node scheduling, dependencies, failure handling, and review gates.
- [Agent tools](docs/canvas-tool-calls.md): tool definitions, parameters, and validation rules.
- [SSE protocol](docs/agent-sse-data-design.md): progress events, reconnect behavior, and continuation.
- [HTTP API](docs/api.md): canvas, session, execution, and asset endpoints.
- [Meshy Agent SSE](docs/meshy-agent-sse-protocol.md): Agent SSE conventions for Meshy-related execution.
- [Todo](docs/todo.md): current limitations and planned work.
- [Progress](docs/progress.md): current project status organized by capability.
- [Docker and local database](docker/README.md): local PostgreSQL startup and storage responsibilities.

## Current Limitations

- The Cloudflare deployment uses D1 but does not have R2, so application uploads of images and 3D files cannot be persisted.
- Real Tripo and Meshy execution is currently available only through the local Node runtime; the Cloudflare deployment can use Mock workflows.
- Local PostgreSQL and Cloudflare D1 do not synchronize automatically.
