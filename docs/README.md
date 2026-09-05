# Forge3D Documentation

The repository-root [`README.md`](../README.md) covers product features, usage, prerequisites, and startup instructions. This directory contains architecture, data design, protocol, API, and implementation details.

## Project and Architecture

- [`project-reference.md`](project-reference.md): complete project reference covering the interaction model, data structures, Agent architecture, persistence, local runtime, and Cloudflare deployment.
- [`execution-engine.md`](execution-engine.md): workflow planning, node scheduling, upstream and downstream data flow, cancellation, failures, and review gates.
- [`embedding.md`](embedding.md): boundaries and integration guidance for embedding Forge3D in another page or host application.

## Agent and Protocols

- [`canvas-tool-calls.md`](canvas-tool-calls.md): canvas tools available to the Agent, including schemas, parameter validation, and examples.
- [`agent-sse-data-design.md`](agent-sse-data-design.md): Agent turns, SSE events, correlation fields, continuation, and reconnect behavior.
- [`meshy-agent-sse-protocol.md`](meshy-agent-sse-protocol.md): reference protocol for Meshy-related Agent SSE behavior.

## API and Runtime

- [`api.md`](api.md): the HTTP API shared by the Node API and Cloudflare Worker, including runtime capability differences.
- [`../docker/README.md`](../docker/README.md): local PostgreSQL container, table responsibilities, and file-store fallback.

## Project Status

- [`progress.md`](progress.md): current implementation and verification status organized by capability.
- [`todo.md`](todo.md): known limitations and planned work.

## Runtime Boundaries

- The local Node runtime can use PostgreSQL or fall back to JSON documents and local asset files.
- The local Node runtime supports persistent uploads and can use Tripo and Meshy for real generation tasks.
- The Cloudflare Worker uses D1 for application data and does not connect to local PostgreSQL.
- Cloudflare does not currently have an R2 binding, so user-uploaded images and models are not persisted there.
- Local PostgreSQL, the file store, and Cloudflare D1 do not synchronize automatically.
