export async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, options)
  const text = response.status === 204 ? '' : await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`Invalid JSON response (${response.status}) from ${url}`)
    }
  }
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status}) for ${url}`)
    Object.assign(error, { status: response.status, data })
    throw error
  }
  return data
}
