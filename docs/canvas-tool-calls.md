# Canvas Agent Tool Calls

## Purpose

This document describes the canvas tools available to both agent paths:

- Direct DeepSeek in `server/deepseek.ts`
- Pi agent-service in `agent-service/run.ts`

Both paths consume the shared definitions in `server/canvas-tools.ts`. That file is the runtime source of truth for tool names, descriptions, JSON Schemas, required fields, enums, limits, and `additionalProperties` rules. Update the shared definitions first when the contract changes, then update this document and `server/canvas-tools.test.ts`.

## General Rules

- All seven tools receive one JSON object as their arguments.
- Every top-level argument object is closed with `additionalProperties: false`.
- The model must use exact node IDs returned by `get_canvas_structure` when updating an existing node.
- `build_canvas` appends a new framed section. It does not replace existing canvas content.
- JSON Schema validates the model-facing contract. Execution-time validation still enforces canvas-specific business rules.
- Tool results shown below are representative examples, not a separate API contract.

## Tool Summary

| Tool | Purpose | Required arguments |
| --- | --- | --- |
| `get_canvas_structure` | Inspect every node and edge on the current canvas. | None |
| `list_available_node_types` | List node types that can be created. | None |
| `build_canvas` | Append a complete framed canvas section. | `nodeTypes` |
| `get_canvas_parameters` | Inspect adjustable parameters and valid values. | None |
| `update_node_parameters` | Update validated parameters on one existing node. | `nodeId`, `parameters` |
| `add_canvas_node` | Add one supported node if it is not already present. | `type` |
| `request_user_select` | Pause and ask the user to select from finite options. | `prompt`, `options`, `min`, `max` |

## 1. `get_canvas_structure`

Inspects the complete current canvas. The result includes every node and edge across all canvas sections, rather than one frame or one canvas chain.

### Arguments

```json
{}
```

No arguments or additional properties are accepted.

### Example Call

```json
{
  "name": "get_canvas_structure",
  "arguments": {}
}
```

### Example Result

```json
{
  "nodes": [
    { "id": "generate-model", "type": "generate-model", "name": "Gen HD Model" },
    { "id": "export-model", "type": "export-model", "name": "Export" }
  ],
  "edges": [
    {
      "source": { "nodeId": "generate-model", "port": "output" },
      "target": { "nodeId": "export-model", "port": "input" }
    }
  ]
}
```

## 2. `list_available_node_types`

Lists every node type the agent can create. This data is separate from the current canvas structure.

### Arguments

```json
{}
```

### Example Result

```json
{
  "nodeTypes": [
    "reference-image",
    "prompt",
    "generate-image",
    "generate-multiview-images",
    "generate-model",
    "smart-mesh",
    "multiview-to-3d",
    "review",
    "text-to-3d",
    "retopology",
    "bake",
    "texture",
    "rigging",
    "segments",
    "model-preview",
    "export-model"
  ]
}
```

## 3. `build_canvas`

Appends a new canvas section from an ordered node type list. The server creates the frame, places the new nodes inside it, and connects compatible nodes automatically.

### Arguments

| Field | Type | Constraints |
| --- | --- | --- |
| `nodeTypes` | `string[]` | Required; at least one entry; every entry must be a supported node type. Do not include `frame`. |

Supported node types:

```text
reference-image
prompt
generate-image
generate-multiview-images
generate-model
smart-mesh
multiview-to-3d
review
text-to-3d
retopology
bake
texture
rigging
segments
model-preview
export-model
```

### Example Call

```json
{
  "name": "build_canvas",
  "arguments": {
    "nodeTypes": [
      "reference-image",
      "generate-multiview-images",
      "generate-model",
      "retopology",
      "export-model"
    ]
  }
}
```

### Example Result

```json
{
  "frameId": "frame-main-2",
  "nodes": [
    { "id": "reference-image-2", "type": "reference-image", "name": "Image Upload" },
    { "id": "generate-multiview-images-2", "type": "generate-multiview-images", "name": "Generate Multi-view Images" },
    { "id": "generate-model-2", "type": "generate-model", "name": "Gen HD Model" },
    { "id": "retopology-2", "type": "retopology", "name": "Retopology" },
    { "id": "export-model-2", "type": "export-model", "name": "Export" }
  ],
  "edges": [
    { "source": "reference-image-2", "target": "generate-multiview-images-2" },
    { "source": "generate-multiview-images-2", "target": "generate-model-2" },
    { "source": "generate-model-2", "target": "retopology-2" },
    { "source": "retopology-2", "target": "export-model-2" }
  ]
}
```

## 4. `get_canvas_parameters`

Lists adjustable parameters for all nodes currently present on the canvas, including valid ranges and enum options.

### Arguments

```json
{}
```

No arguments or additional properties are accepted.

### Example Call

```json
{
  "name": "get_canvas_parameters",
  "arguments": {}
}
```

### Example Result

```json
{
  "nodes": [
    { "id": "retopology", "type": "retopology", "name": "Retopology" },
    { "id": "export-model", "type": "export-model", "name": "Export" }
  ],
  "parameters": "Retopology: target face count (500-20,000), model version (v2.0, v1.0), face type (Triangle, Quad), bake textures (on/off)\nExport: model format (GLB, OBJ, FBX, STL), export outputs (dcc, texture, bambu, multiple allowed)"
}
```

## 5. `update_node_parameters`

Updates one existing node. `nodeId` must be the exact ID returned by `get_canvas_structure`; a display name or node type is not sufficient.

### Arguments

| Field | Type | Constraints |
| --- | --- | --- |
| `nodeId` | `string` | Required; exact existing node ID. |
| `parameters` | `object` | Required; only canonical parameter names are accepted; unknown properties are rejected. |

Canonical parameter constraints:

| Parameter | Type | Allowed value or range |
| --- | --- | --- |
| `sourceType` | string | `Upload`, `Asset Library`, `URL` |
| `reference` | string | Any string |
| `background` | string | `Keep`, `Remove` |
| `prompt` | string | Any string |
| `strength` | number | 0-100, step 1 |
| `model` | string | `GPT Image 2`, `Flux 1.1 Pro`, `Stable Diffusion 3.5` |
| `count` | number | 1-4, step 1 |
| `aspectRatio` | string | `1:1`, `4:3`, `3:4`, `16:9` |
| `referenceMode` | string | `Image + Prompt`, `Prompt only`, `Image variation` |
| `faceCount` | number | 1,000-50,000, step 1,000 |
| `modelVersion` | string | `Smart Mesh`, `v2.5`, `v2.0`, `v1.0` |
| `textureMode` | string | `None`, `HD`, `PBR` |
| `faceType` | string | `Triangle`, `Quad` |
| `textureQuality` | string | `No texture`, `Standard`, `HD`, `2K`, `4K`, `8K` |
| `pbr` | boolean | `true` or `false` |
| `faceLimit` | number | 500-20,000, step 500 |
| `bakeTextures` | boolean | `true` or `false` |
| `subdivision` | string | `Low`, `Medium`, `High` |
| `complete` | boolean | `true` or `false` |
| `environment` | string | `Studio`, `Outdoor`, `Neutral` |
| `autoRotate` | boolean | `true` or `false` |
| `wireframe` | boolean | `true` or `false` |
| `modelFormat` | string | `GLB`, `OBJ`, `FBX`, `STL` |
| `exportTargets` | `string[]` | Unique values selected from `dcc`, `texture`, `bambu` |

Not every parameter applies to every node type. Execution-time validation rejects a canonical parameter when the selected node does not support it.

### Example Call

```json
{
  "name": "update_node_parameters",
  "arguments": {
    "nodeId": "retopology",
    "parameters": {
      "faceLimit": 8000,
      "faceType": "Quad",
      "bakeTextures": true
    }
  }
}
```

### Example Result

```json
{
  "changes": [
    { "nodeId": "retopology", "nodeLabel": "Retopology", "fieldLabel": "target face count", "previousValue": 10000, "value": 8000 },
    { "nodeId": "retopology", "nodeLabel": "Retopology", "fieldLabel": "face type", "previousValue": "Triangle", "value": "Quad" }
  ]
}
```

## 6. `add_canvas_node`

Adds one supported canvas node when that node type is not already present. Unlike `build_canvas`, this tool can explicitly add a `frame`.

### Arguments

| Field | Type | Constraints |
| --- | --- | --- |
| `type` | string | Required; `frame` or one of the supported node types listed under `build_canvas`. |

### Example Call

```json
{
  "name": "add_canvas_node",
  "arguments": {
    "type": "texture"
  }
}
```

### Example Result

```json
{
  "addedNodeIds": ["texture"]
}
```

## 7. `request_user_select`

Pauses the current turn and asks the user to select one or more items from a finite option set. It is not intended for free-form input.

### Arguments

| Field | Type | Constraints |
| --- | --- | --- |
| `prompt` | string | Required; at least one character. |
| `options` | object array | Required; at least one option. |
| `options[].id` | string | Required; at least one character. |
| `options[].label` | string | Required; at least one character. |
| `min` | integer | Required; at least 1. |
| `max` | integer | Required; at least 1. |

Each option is closed and accepts only `id` and `label`. Execution-time validation additionally checks unique IDs, valid selection bounds, and that returned selections belong to the supplied options.

### Example Call

```json
{
  "name": "request_user_select",
  "arguments": {
    "prompt": "Choose a canvas approach",
    "options": [
      { "id": "text-to-3d", "label": "Generate directly from text" },
      { "id": "image-to-3d", "label": "Generate from a reference image" }
    ],
    "min": 1,
    "max": 1
  }
}
```

### Example Result

```json
{
  "selected": ["image-to-3d"]
}
```

## Example Tool-Call Log

The following illustrative log shows one agent turn that inspects the canvas, appends a canvas section, updates two nodes, and completes. It is formatted as JSON Lines so each line can be parsed independently. This is documentation only; the application does not currently persist this exact log format.

```jsonl
{"timestamp":"2026-07-28T09:00:00.000Z","event":"user_message","turnId":"turn-42","message":"Create an image-to-3D canvas, use quad retopology at 8000 faces, and export STL."}
{"timestamp":"2026-07-28T09:00:00.120Z","event":"tool_call","turnId":"turn-42","toolCallId":"call-1","name":"get_canvas_structure","arguments":{}}
{"timestamp":"2026-07-28T09:00:00.121Z","event":"progress","turnId":"turn-42","toolCallId":"call-1","label":"Inspecting canvas structure","status":"running"}
{"timestamp":"2026-07-28T09:00:00.130Z","event":"tool_result","turnId":"turn-42","toolCallId":"call-1","name":"get_canvas_structure","isError":false,"result":{"nodes":[],"edges":[]}}
{"timestamp":"2026-07-28T09:00:00.310Z","event":"tool_call","turnId":"turn-42","toolCallId":"call-2","name":"build_canvas","arguments":{"nodeTypes":["reference-image","generate-model","retopology","export-model"]}}
{"timestamp":"2026-07-28T09:00:00.311Z","event":"progress","turnId":"turn-42","toolCallId":"call-2","label":"Building canvas","status":"running"}
{"timestamp":"2026-07-28T09:00:00.340Z","event":"tool_result","turnId":"turn-42","toolCallId":"call-2","name":"build_canvas","isError":false,"result":{"frameId":"frame-main","nodes":[{"id":"reference-image","type":"reference-image","name":"Image Upload"},{"id":"generate-model","type":"generate-model","name":"Gen HD Model"},{"id":"retopology","type":"retopology","name":"Retopology"},{"id":"export-model","type":"export-model","name":"Export"}],"edges":[{"source":"reference-image","target":"generate-model"},{"source":"generate-model","target":"retopology"},{"source":"retopology","target":"export-model"}]}}
{"timestamp":"2026-07-28T09:00:00.510Z","event":"tool_call","turnId":"turn-42","toolCallId":"call-3","name":"update_node_parameters","arguments":{"nodeId":"retopology","parameters":{"faceLimit":8000,"faceType":"Quad"}}}
{"timestamp":"2026-07-28T09:00:00.511Z","event":"progress","turnId":"turn-42","toolCallId":"call-3","label":"Updating node parameters","status":"running"}
{"timestamp":"2026-07-28T09:00:00.520Z","event":"tool_result","turnId":"turn-42","toolCallId":"call-3","name":"update_node_parameters","isError":false,"result":{"changes":[{"nodeId":"retopology","nodeLabel":"Retopology","fieldLabel":"target face count","previousValue":10000,"value":8000},{"nodeId":"retopology","nodeLabel":"Retopology","fieldLabel":"face type","previousValue":"Triangle","value":"Quad"}]}}
{"timestamp":"2026-07-28T09:00:00.690Z","event":"tool_call","turnId":"turn-42","toolCallId":"call-4","name":"update_node_parameters","arguments":{"nodeId":"export-model","parameters":{"modelFormat":"STL"}}}
{"timestamp":"2026-07-28T09:00:00.691Z","event":"progress","turnId":"turn-42","toolCallId":"call-4","label":"Updating node parameters","status":"running"}
{"timestamp":"2026-07-28T09:00:00.700Z","event":"tool_result","turnId":"turn-42","toolCallId":"call-4","name":"update_node_parameters","isError":false,"result":{"changes":[{"nodeId":"export-model","nodeLabel":"Export","fieldLabel":"model format","previousValue":"GLB","value":"STL"}]}}
{"timestamp":"2026-07-28T09:00:00.850Z","event":"assistant_message","turnId":"turn-42","message":"Created an image-to-3D canvas with quad retopology set to 8,000 faces and STL export."}
```

An error result uses the same correlation fields and sets `isError` to `true`:

```jsonl
{"timestamp":"2026-07-28T09:05:00.000Z","event":"tool_call","turnId":"turn-43","toolCallId":"call-5","name":"update_node_parameters","arguments":{"nodeId":"retopology","parameters":{"faceLimit":8250}}}
{"timestamp":"2026-07-28T09:05:00.010Z","event":"tool_result","turnId":"turn-43","toolCallId":"call-5","name":"update_node_parameters","isError":true,"error":"target face count must be 500-20000 in steps of 500."}
```
