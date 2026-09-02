export const ALLOWED_ORIGIN = 'https://nimpulse.vercel.app'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

export function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS })
}

export function withCors(response: Response, request: Request): Response {
  const origin = request.headers.get('origin')
  if (origin !== ALLOWED_ORIGIN) {
    return response
  }
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', origin)
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS')
  headers.set('access-control-allow-headers', 'content-type')
  headers.set('vary', 'Origin')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function preflight(request: Request): Response {
  if (request.headers.get('origin') !== ALLOWED_ORIGIN) {
    return json({ error: 'Origin not allowed.' }, 403)
  }
  return new Response(null, { status: 204, headers: JSON_HEADERS })
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number.parseInt(request.headers.get('content-length') || '0', 10)
  if (contentLength > 16_384) {
    throw new Error('Request body is too large.')
  }
  const body: unknown = await request.json()
  return body !== null && typeof body === 'object' ? body as Record<string, unknown> : {}
}
