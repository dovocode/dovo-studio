import { createHash } from 'node:crypto'
import { routineMonitorUrl } from '@dovo/protocol'
/** A bounded GET. No cookies, authorization, browser session or model tools are used. */
export async function readRoutineSource(value: string, signal: AbortSignal) {
  let url = routineMonitorUrl(value)
  for (let redirect = 0; redirect <= 3; redirect++) {
    const response = await fetch(url, {
      signal,
      redirect: 'manual',
      headers: { Accept: 'text/plain, text/html, application/json, application/xml' },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location || redirect === 3)
        throw new Error('Monitoring source redirected too many times.')
      url = routineMonitorUrl(new URL(location, url).href)
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Monitoring source returned HTTP ${response.status}.`)
    }
    if (!response.body) throw new Error('Monitoring source returned no content.')
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        length += chunk.byteLength
        if (length > 512 * 1024) throw new Error('Monitoring source exceeds 512 KiB.')
        chunks.push(chunk)
      }
    } finally {
      await reader.cancel()
    }
    if (!length) throw new Error('Monitoring source returned empty content.')
    const bytes = Buffer.concat(chunks)
    return {
      hash: createHash('sha256').update(bytes).digest('hex'),
      url: url.href,
      text: bytes.toString('utf8').slice(0, 24000),
    }
  }
  throw new Error('Monitoring source could not be read.')
}
