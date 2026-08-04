# Forge3D Canvas Studio

[Live Demo](https://forge3d.lumixraku.org/)

Forge3D is a local-first, conversational canvas studio for designing reusable
3D production pipelines. A DeepSeek-powered Agent edits a versioned JSON DAG,
while Vue Flow renders it as an editable infinite canvas.

## Documentation

- [Project reference](docs/project-reference.md): product behavior, data model,
  Agent protocol, execution, persistence, deployment, and limitations.
- [HTTP API reference](docs/api.md): Node API, Worker API, SSE, executions, and
  assets.
- [Canvas Agent tool calls](docs/canvas-tool-calls.md): tool schemas and
  examples.
- [Agent SSE data design](docs/agent-sse-data-design.md): application event
  lifecycle and recovery behavior.
- [Meshy Agent SSE protocol](docs/meshy-agent-sse-protocol.md): external
  protocol research.
- [Todo](docs/todo.md): pending Tripo operation-history and asset-recovery work.

## Quick Start

Requirements: Node.js 20+ and pnpm `11.16.0`.

```bash
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Set `DEEPSEEK_API_KEY` in `.env` for chat features. Set `TRIPO_API_KEY` to
enable real Tripo v3 execution; without it, execution uses the mock provider.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm build
```

The detailed project reference is the canonical entry point for reproducing
the current application behavior. When documentation and implementation
diverge, follow the source-of-truth order documented there.
