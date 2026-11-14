import { createHash } from 'node:crypto'
import { decode, routineJsonPointerSchema, routineMonitorUrl } from '@dovo/protocol'
/** A bounded GET. No cookies, authorization, browser session or model tools are used. */
export async function readRoutineSource(value: string, signal: AbortSignal, jsonPointer?: string) {
  if (jsonPointer !== undefined) decode(routineJsonPointerSchema, jsonPointer)
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
    return routineSourceContent(bytes, url.href, jsonPointer)
  }
  throw new Error('Monitoring source could not be read.')
}
export function routineSourceContent(bytes: Buffer, url: string, jsonPointer?: string) {
  if (jsonPointer !== undefined) decode(routineJsonPointerSchema, jsonPointer)
  const content =
    jsonPointer === undefined
      ? bytes
      : Buffer.from(JSON.stringify(selectJson(JSON.parse(bytes.toString('utf8')), jsonPointer)))
  return {
    hash: createHash('sha256').update(content).digest('hex'),
    url,
    text: content.toString('utf8').slice(0, 24000),
  }
}

/** Canonical JSON ignores object key order, but preserves array order and value types. */
function selectJson(input: unknown, pointer: string): unknown {
  let value = input
  for (const part of pointer === '' ? [] : pointer.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
    if (
      typeof value !== 'object' ||
      value === null ||
      !Object.prototype.hasOwnProperty.call(value, key) ||
      (Array.isArray(value) && !/^(?:0|[1-9]\d*)$/.test(key))
    )
      throw new Error('Monitoring JSON pointer was not found.')
    value = Reflect.get(value, key)
  }
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical)
    if (item !== null && typeof item === 'object')
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, canonical(Reflect.get(item, key))]),
      )
    return item
  }
  return canonical(value)
}
