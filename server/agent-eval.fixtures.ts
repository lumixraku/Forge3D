export const agentEvalFixtures = [
  {
    name: 'builds a text-to-3d production DAG',
    prompt: 'Build a text-to-3D pipeline with retopology and export',
    toolCalls: [
      {
        name: 'build_canvas',
        arguments: {
          nodeTypes: ['prompt', 'text-to-3d', 'retopology', 'export-model'],
        },
      },
    ],
    expectedTypes: ['prompt', 'text-to-3d', 'retopology', 'export-model'],
  },
  {
    name: 'builds a multiview reconstruction DAG',
    prompt: 'Turn one reference image into multiple views and reconstruct a 3D model',
    toolCalls: [
      {
        name: 'build_canvas',
        arguments: {
          nodeTypes: ['reference-image', 'generate-multiview-images', 'generate-model', 'export-model'],
        },
      },
    ],
    expectedTypes: ['reference-image', 'generate-multiview-images', 'generate-model', 'export-model'],
  },
  {
    name: 'updates the selected node without changing structure',
    prompt: 'Set the text-to-3D face count to 12000',
    seedPrompt: 'Create a text-to-3D canvas',
    toolCalls: [
      {
        name: 'update_node_parameters',
        arguments: { nodeId: 'text-to-3d', parameters: { faceCount: 12000 } },
      },
    ],
    expectedTypes: [],
    expectedParameter: { nodeId: 'text-to-3d', key: 'faceCount', value: 12000 },
  },
]
