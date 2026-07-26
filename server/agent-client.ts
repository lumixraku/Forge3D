// Calls the standalone Pi agent service (see agent-service/) and adapts its
// NDJSON stream back to the same return contract as runDeepSeekAgent, so the
// Worker and dev server can swap one for the other. Uses only fetch + web
// streams, so it runs in both Node and the Cloudflare Workers runtime.

export async function runAgentViaService(opts: any) {
  const { serviceUrl, apiKey, baseUrl, model, message, workflow, onProgress = async () => {} } = opts
  const response = await fetch(serviceUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey, baseUrl, model, message, workflow }),
  })
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Agent service failed with status ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let plan: any
  let serviceError: string | undefined

  const handleLine = async (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const message = JSON.parse(trimmed)
    if (message.type === 'progress') await onProgress(message.event)
    else if (message.type === 'result') plan = message.plan
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
  if (!plan) throw new Error('Agent service returned no result')
  return plan
}
