export async function catalogBytes(url: string, maxBytes = 4_000_000): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  })
  if (!response.ok)
    throw new Error(
      `Catalog request failed (${response.status}). ${response.status === 429 || response.status === 403 ? 'The catalog rate limit may have been reached. Try again later.' : 'Try again or check the source website.'}`,
    )
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel()
    throw new Error('Catalog response is too large')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Empty catalog response')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maxBytes) throw new Error('Catalog response is too large')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

export async function catalogJson(url: string, maxBytes = 4_000_000): Promise<unknown> {
  return JSON.parse((await catalogBytes(url, maxBytes)).toString('utf8'))
}
