import { createServer } from 'node:http'
import { startPiAgent, type LiveRun } from './run.js'
import { listenOnAvailablePort } from '../server/listen.js'

// Standalone Node service that runs the Pi-framework agent. It streams NDJSON:
// one {type:'progress', event} line per progress step, then a final
// {type:'result', plan} or {type:'error', error} line. Kept separate from the
// Cloudflare Worker because Pi depends on Node built-ins (node:fs/os) that the
// Workers runtime does not provide.
//
// Each /agent request owns an independent Pi run and NDJSON stream.

const port = Number(process.env.AGENT_SERVICE_PORT || 8788)

// Every task owns an independent Pi run. Canvas identity must not collapse
// unrelated work into one steering queue.
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
  if (req.method === 'POST' && req.url === '/agent/cancel') {
    try {
      const input = JSON.parse(await readBody(req))
      const current = liveRuns.get(input.taskId || input.turnId)
      if (current) {
        liveRuns.delete(input.taskId || input.turnId)
        current.abort()
        await current.done.catch(() => {})
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ cancelled: Boolean(current) }))
    } catch (error: any) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: error?.message || 'Unable to cancel agent run' }))
    }
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
    const taskId = input.taskId || input.turnId
    const canvasId = input.canvas?.id || ''
    const preview = String(input.message || '').slice(0, 80)

    console.log(`[agent-service] Pi START (${taskId}, ${canvasId}): ${preview}`)
    const live = startPiAgent({
      turnId: input.turnId,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
      timeoutMs: Number(process.env.AGENT_TIMEOUT_MS || 120_000),
      message: input.message,
      canvas: input.canvas,
      account: input.account,
      executions: input.executions,
      checkpoint: input.checkpoint,
      onProgress: (event) => write({ type: 'progress', event }),
      onTrace: (event) => write({ type: 'trace', event }),
      onCheckpoint: (checkpoint) => write({ type: 'checkpoint', checkpoint }),
    })
    if (taskId) liveRuns.set(taskId, live)
    try {
      const plan = await live.done
      write({ type: 'result', plan })
    } catch (error: any) {
      if (error?.name === 'AbortError') write({ type: 'cancelled' })
      else throw error
    } finally {
      if (taskId && liveRuns.get(taskId) === live) liveRuns.delete(taskId)
    }
  } catch (error: any) {
    write({ type: 'error', error: error?.message || 'Agent service failure' })
  } finally {
    res.end()
  }
})

const listeningPort = await listenOnAvailablePort(server, port, '127.0.0.1')
console.log(`[agent-service] Pi agent listening on http://127.0.0.1:${listeningPort}`)
