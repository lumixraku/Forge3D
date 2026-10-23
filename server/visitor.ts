// Anonymous visitor identity. There is no login, so each browser gets a random
// ID in an HttpOnly cookie on its first request and every record it creates is
// tagged with it. This identifies a browser, not a person: clearing cookies or
// switching browsers starts a new, empty visitor.

export const VISITOR_COOKIE = 'forge3d_visitor'
const ONE_YEAR = 60 * 60 * 24 * 365
const VISITOR_ID = /^visitor-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Returns the request's visitor ID, minting one when the cookie is missing or malformed. */
export function readVisitor(request: Request) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0 || part.slice(0, index).trim() !== VISITOR_COOKIE) continue
    const value = part.slice(index + 1).trim()
    if (VISITOR_ID.test(value)) return { visitorId: value, isNew: false }
  }
  return { visitorId: `visitor-${globalThis.crypto.randomUUID()}`, isNew: true }
}

export function visitorCookie(visitorId: string, request: Request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${VISITOR_COOKIE}=${visitorId}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; SameSite=Lax${secure}`
}
