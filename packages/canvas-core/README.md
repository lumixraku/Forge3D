# @forge3d/canvas-core

The canvas domain, shared by every consumer of a Forge3D canvas.

**Belongs here** — anything that answers "what is a canvas": node schema and
parameters, ports and their compatibility, the graph and its validation, result
slots, frame geometry, wire ties, the starter graph.

**Does not belong here** — React components, DOM access, Node APIs, HTTP, storage,
provider SDKs. Every module here must run unchanged in the browser, in the
server, and inside the DeepSeek Harness plugin process.

Consumers import the package root (`@forge3d/canvas-core`), never a file path
inside it. Resolution is wired in three places, because the three consumers
resolve differently:

| Consumer | Wiring |
| --- | --- |
| TypeScript / `tsx` (tests, server) | `paths` in `tsconfig.json` |
| Vite (web + plugin UI) | `resolve.alias` in both Vite configs |
| esbuild (plugin server bundle) | `--alias:@forge3d/canvas-core=...` |
