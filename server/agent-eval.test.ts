import assert from 'node:assert/strict'
import test from 'node:test'
import { appendAgentTrace, createAgentTrace } from './agent-traces.js'
import { runDeepSeekAgent } from './deepseek.js'
import { agentEvalFixtures } from './agent-eval.fixtures.js'
import { createCanvas } from './canvases.js'
import { planCanvas } from './planner.js'

function modelResponse(message: any) {
  return Response.json({ choices: [{ message }] })
}

for (const fixture of agentEvalFixtures) {
  test(`agent eval: ${fixture.name}`, async () => {
    const canvas = fixture.seedPrompt
      ? planCanvas(fixture.seedPrompt).canvas
      : createCanvas({ name: 'Agent eval', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
    const responses = [
      modelResponse({
        role: 'assistant',
        content: '',
        tool_calls: fixture.toolCalls.map((call, index) => ({
          id: `eval-call-${index + 1}`,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      }),
      modelResponse({ role: 'assistant', content: 'Completed the requested canvas change.' }),
    ]
    const trace = createAgentTrace({ id: 'eval-turn', sessionId: 'eval-session', canvasId: canvas.id })
    const checkpoints: any[] = []

    const result = await runDeepSeekAgent({
      apiKey: 'offline-eval-key',
      message: fixture.prompt,
      canvas,
      fetchImpl: async () => {
        const response = responses.shift()
        assert.ok(response, 'agent requested more fixed model responses than the fixture supplied')
        return response
      },
      onTrace: (event) => appendAgentTrace(trace, event.type, event.payload),
      onCheckpoint: (checkpoint) => checkpoints.push(structuredClone(checkpoint)),
    })

    const addedTypes = result.canvas.nodes.slice(canvas.nodes.length).filter((node: any) => node.type !== 'frame').map((node: any) => node.type)
    assert.deepEqual(addedTypes, fixture.expectedTypes)
    if (fixture.expectedParameter) {
      const { nodeId, key, value } = fixture.expectedParameter
      assert.equal(result.canvas.nodes.find((node: any) => node.id === nodeId)?.config[key], value)
    }
    assert.equal(result.reply, 'Completed the requested canvas change.')
    assert.ok(trace.events.some((event) => event.type === 'tool_call_succeeded'))
    assert.ok(trace.events.every((event) => !JSON.stringify(event).includes('offline-eval-key')))
    assert.equal(checkpoints.at(-1)?.phase, 'tool_complete')
  })
}
