import type { Server } from 'node:http'

export function listenOnAvailablePort(server: Server, requestedPort: number, host?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = requestedPort

    server.once('listening', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('Unable to resolve listening port'))
      resolve(address.port)
    })
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EADDRINUSE' || requestedPort === 0 || port >= 65535) return reject(error)
      console.warn(`Port ${port} is in use, trying ${port + 1}...`)
      server.listen(++port, host)
    })

    server.listen(port, host)
  })
}
