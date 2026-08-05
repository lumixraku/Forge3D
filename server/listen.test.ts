import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { listenOnAvailablePort } from './listen.js'

test('increments the requested port when it is occupied', async () => {
  const blocker = createServer()
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
  const address = blocker.address()
  assert(address && typeof address !== 'string')

  const server = createServer()
  try {
    const port = await listenOnAvailablePort(server, address.port, '127.0.0.1')
    assert(port > address.port)
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => blocker.close(() => resolve())),
    ])
  }
})
