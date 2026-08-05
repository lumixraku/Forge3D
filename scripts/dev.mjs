import { createServer } from 'node:net'
import { spawn } from 'node:child_process'

async function reservePort(startPort) {
  for (let port = startPort; port <= 65535; port += 1) {
    const reservation = createServer()
    try {
      await new Promise((resolve, reject) => {
        reservation.once('error', reject)
        reservation.listen(port, '127.0.0.1', resolve)
      })
      return { port, release: () => new Promise((resolve) => reservation.close(resolve)) }
    } catch (error) {
      reservation.close()
      if (error.code !== 'EADDRINUSE') throw error
    }
  }
  throw new Error(`No available port found from ${startPort}`)
}

const agent = await reservePort(Number(process.env.AGENT_SERVICE_PORT || 8788))
const api = await reservePort(Number(process.env.PORT || 8787))
await Promise.all([agent.release(), api.release()])

const env = {
  ...process.env,
  PORT: String(api.port),
  AGENT_SERVICE_PORT: String(agent.port),
  AGENT_SERVICE_URL: `http://127.0.0.1:${agent.port}/agent`,
  VITE_API_URL: `http://127.0.0.1:${api.port}`,
}
const child = spawn('pnpm', ['exec', 'concurrently', '-k', 'pnpm run agent:service', 'pnpm run dev:server', 'pnpm run dev:web'], {
  env,
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
