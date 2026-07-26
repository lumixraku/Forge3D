import { createServer } from 'node:http'
import { startPiAgent, type LiveRun } from './run.js'

// Standalone Node service that runs the Pi-framework agent. It streams NDJSON:
// one {type:'progress', event} line per progress step, then a final
// {type:'result', plan} or {type:'error', error} line. Kept separate from the
// Cloudflare Worker because Pi depends on Node built-ins (node:fs/os) that the
// Workers runtime does not provide.
//
// Steering: while a run for a workflow is still streaming, a second POST for the
// same workflow is not a new run — its message is injected into the live Pi
// Agent via agent.steer() and the request returns {type:'steered'} immediately.
// The eventual workflow diff flows out of the ORIGINAL run's stream.

const port = Number(process.env.AGENT_SERVICE_PORT || 8788)

// Live runs keyed by workflowId, so a follow-up request can find the agent to steer.
const liveRuns = new Map<string, LiveRun>()

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }
  if (req.method !== 'POST' || req.url !== '/agent') {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
    return
  }

  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' })
  const write = (line: unknown) => res.write(JSON.stringify(line) + '\n')

  try {
    const input = JSON.parse(await readBody(req))
    if (!input.apiKey) throw new Error('Missing apiKey')
    const workflowId = input.workflow?.id || ''
    const preview = String(input.message || '').slice(0, 80)

    // Steer path: a run for this workflow is still streaming -> inject the message.
    const existing = workflowId ? liveRuns.get(workflowId) : undefined
    if (existing && existing.agent.state.isStreaming) {
      console.log(`[agent-service] Pi STEER (${workflowId}): ${preview}`)
      existing.steer(input.message)
      write({ type: 'steered' })
      return
    }

    // Start path: begin a new run and register it so it can be steered.
    console.log(`[agent-service] Pi START (${workflowId}): ${preview}`)
    const live = startPiAgent({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
      message: input.message,
      workflow: input.workflow,
      onProgress: (event) => write({ type: 'progress', event }),
    })
    if (workflowId) liveRuns.set(workflowId, live)
    try {
      const plan = await live.done
      write({ type: 'result', plan })
    } finally {
      if (workflowId && liveRuns.get(workflowId) === live) liveRuns.delete(workflowId)
    }
  } catch (error: any) {
    write({ type: 'error', error: error?.message || 'Agent service failure' })
  } finally {
    res.end()
  }
})

server.listen(port, () => {
  console.log(`[agent-service] Pi agent listening on http://127.0.0.1:${port}`)
})
