// Calls the standalone Pi agent service (see agent-service/) and adapts its
// NDJSON stream back to the same return contract as runDeepSeekAgent, so the
// Worker and dev server can swap one for the other. Uses only fetch + web
// streams, so it runs in both Node and the Cloudflare Workers runtime.

export async function runAgentViaService(opts: any) {
  const { serviceUrl, turnId, apiKey, baseUrl, model, message, canvas, account, executions, checkpoint, signal, onProgress = async () => {}, onTrace = async () => {}, onCheckpoint = async () => {} } = opts
  const response = await fetch(serviceUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ turnId, apiKey, baseUrl, model, message, canvas, account, executions, checkpoint }),
    signal,
  })
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Agent service failed with status ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let plan: any
  let steered = false
  let cancelled = false
  let serviceError: string | undefined

  const handleLine = async (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const message = JSON.parse(trimmed)
    if (message.type === 'progress') await onProgress(message.event)
    else if (message.type === 'trace') await onTrace(message.event)
    else if (message.type === 'checkpoint') await onCheckpoint(message.checkpoint)
    else if (message.type === 'result') plan = message.plan
    else if (message.type === 'steered') steered = true
    else if (message.type === 'cancelled') cancelled = true
    else if (message.type === 'error') serviceError = message.error
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      await handleLine(buffer.slice(0, index))
      buffer = buffer.slice(index + 1)
    }
  }
  await handleLine(buffer)

  if (serviceError) throw new Error(serviceError)
  if (cancelled) {
    const error = new Error('Agent run cancelled')
    error.name = 'AbortError'
    throw error
  }
  // The message was injected into an already-running run; no plan of its own.
  if (steered) return { steered: true }
  if (!plan) throw new Error('Agent service returned no result')
  return plan
}

export async function cancelAgentViaService(serviceUrl: string, turnId: string) {
  const response = await fetch(new URL('cancel', serviceUrl.endsWith('/') ? serviceUrl : `${serviceUrl}/`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ turnId }),
  })
  if (!response.ok) throw new Error('Agent service could not stop the run')
}
