# @forge3d/dsh-plugin

**Forge3D Canvas** — build 3D asset workflows in the DeepSeek conversation.

Say what you want and the chain appears on the canvas: prompt or reference image
to 3D model, on to UV texture and export. Parameters and stages are edited the same
way, by asking, and the open canvas changes in place.

- **The canvas is the workflow.** Text to 3D, image to 3D and multi-view feed UV
  texturing and GLB/FBX/OBJ export, executed against Meshy or Tripo.
- **The conversation edits it.** The agent reads the canvas, appends stages, changes
  parameters, and removes a step while re-connecting the graph around it.
- **Everything stays local.** Canvases live in a SQLite file on this machine, models
  download from the canvas, and API keys never leave it.

A run still starts with a click on a node's **Run** button: the plugin edits the
graph, it does not execute it.

Under the hood the plugin adds a `conversation.view` tab that renders the Forge3D
canvas as a native React component in the harness page, and serves its API under
`/forge3d/api`, so a conversation and a 3D workflow share one window. The canvas
domain comes from `@forge3d/canvas-core`; the backend is bundled in, so the plugin
runs as a single process with no side service.

## Install

The plugin is a harness bundle, installed into a DSH profile like any dependency.
Until it is published to npm, install it from the repository at a pinned commit:

```bash
cd ~/.dsh/profiles/<profile>
pnpm add "git+https://github.com/lumixraku/Forge3D.git#a3be7c4a897c10fd21881101e9f927d8c182df15&path:/dsh-plugin"
```

Then add it to the profile's `package.json` so the bundle is mounted:

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@forge3d/dsh-plugin"]
    }
  }
}
```

Restart the harness host — bundle registration happens at process start. A
**Canvas** tab then appears next to Chat and Trajectory.

The same commit is tagged
[`v0.1.0`](https://github.com/lumixraku/Forge3D/releases/tag/v0.1.0).

## Build

`lib/client.js` is produced by `vite.config.plugin.ts`, **not** by the root
`vite.config.ts`. It is a `window.__ModuleLoader__.load(...)` bundle that takes
React from the harness shell and carries its CSS scoped to `.forge3d-root`. It is a different application from the web build, not the same
app with a flag:

- no in-app copilot panel (`ChatPanel` resolves to a stub),
- no editor stack (`state/composer` resolves to an inert stub, so `@tiptap/*` and
  ProseMirror never enter the bundle),
- `__FORGE3D_EMBED__` is `true`, which drops the agent column from the layout.

That is worth ~511 kB of JavaScript. The rules for adding another swap — and the
two traps that make a broken swap fail silently — are in the root
[`README.md`](../README.md#build-time-specialization).

```bash
npm run build:plugin          # client bundle + server bundle
npx vite build --config vite.config.plugin.ts
npm run build:plugin-server   # esbuild → lib/server.bundle.mjs
```

## What it gives the agent

| Tool | Purpose |
| --- | --- |
| `forge3d_canvas_list` | List canvases |
| `forge3d_canvas_read` | Read nodes and wires |
| `forge3d_node_types` | Every supported node type |
| `forge3d_describe_node` | Parameters of one type, with ranges |
| `forge3d_canvas_build` | Append a wired workflow section, with parameter overrides |
| `forge3d_canvas_update` | Change one node's parameters |
| `forge3d_canvas_delete` | Delete stages and repair the graph |

## Requirements

- A harness runtime that provides `node:sqlite` (Node 22.5 or newer).
- A Meshy or Tripo API key for generation. Keys are entered in the app and are
  stored per user; nothing is written to logs.

## Data

Everything this plugin owns lives under `~/.dsh/storages/forge3d`:

```
~/.dsh/storages/forge3d/data/forge3d.sqlite   canvases, sessions, runs
~/.dsh/storages/forge3d/data/assets/          uploads and generated files
~/.dsh/storages/forge3d/visitor-id            this install's identity
```

Nothing is written inside the package, so updating or reinstalling it never
touches your work. Uninstalling the package leaves the data in place; delete
that directory to remove it.
