const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function toHeaderObject(headers) {
  const result = {}
  for (const [key, value] of Object.entries(headers || {})) {
    if (value == null) continue
    const lower = key.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lower)) continue
    result[key] = value
  }
  return result
}

function collectRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : null))
    req.on('error', reject)
  })
}

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req, res) {
  const upstreamBaseUrl = normalizeBaseUrl(process.env.API_PROXY_URL || process.env.API_URL)
  if (!upstreamBaseUrl) {
    res.status(500).json({ error: 'Missing API_PROXY_URL environment variable.' })
    return
  }

  const rawPath = String(req.query.path || '').replace(/^\/+/, '')
  if (!rawPath) {
    res.status(400).json({ error: 'Missing path query parameter.' })
    return
  }

  const upstreamUrl = new URL(`${upstreamBaseUrl}/${rawPath}`)
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === 'path') continue
    if (Array.isArray(value)) {
      for (const item of value) upstreamUrl.searchParams.append(key, item)
    } else if (value != null) {
      upstreamUrl.searchParams.set(key, value)
    }
  }

  const method = req.method || 'GET'
  const hasBody = !['GET', 'HEAD'].includes(method.toUpperCase())
  const body = hasBody ? await collectRawBody(req) : undefined
  const requestHeaders = toHeaderObject(req.headers)

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers: requestHeaders,
      body,
      redirect: 'manual',
    })

    res.status(upstreamResponse.status)
    upstreamResponse.headers.forEach((value, key) => {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return
      res.setHeader(key, value)
    })
    res.setHeader('Cache-Control', 'no-store')

    const arrayBuffer = await upstreamResponse.arrayBuffer()
    res.send(Buffer.from(arrayBuffer))
  } catch (error) {
    res.status(502).json({
      error: 'Proxy request failed.',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
