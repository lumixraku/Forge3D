import { createServer } from 'node:http'
import { runPiAgent } from './run.js'

// Standalone Node service that runs the Pi-framework agent. It streams NDJSON:
// one {type:'progress', event} line per progress step, then a final
// {type:'result', plan} or {type:'error', error} line. Kept separate from the
// Cloudflare Worker because Pi depends on Node built-ins (node:fs/os) that the
// Workers runtime does not provide.

const port = Number(process.env.AGENT_SERVICE_PORT || 8788)

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
    console.log(`[agent-service] Pi handling: ${String(input.message || '').slice(0, 80)}`)
    const plan = await runPiAgent({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
      message: input.message,
      workflow: input.workflow,
      onProgress: (event) => write({ type: 'progress', event }),
    })
    write({ type: 'result', plan })
  } catch (error: any) {
    write({ type: 'error', error: error?.message || 'Agent service failure' })
  } finally {
    res.end()
  }
})

server.listen(port, () => {
  console.log(`[agent-service] Pi agent listening on http://127.0.0.1:${port}`)
})
