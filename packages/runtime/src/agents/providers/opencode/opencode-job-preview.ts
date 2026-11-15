import sharp from 'sharp'
import type { Agent, NativeThreadEntry } from '@dovo/protocol'
import { OpenCode, type JobInfo } from '@opencode/client'
import { opencodeAddress, opencodeHeaders } from './opencode-server.js'

/** A cold read must prove job ownership again. Never accept a client-supplied file path. */
export async function readOpencodeJob(
  agent: Agent,
  id: string,
  sessionId: string,
  cwd?: string,
): Promise<NativeThreadEntry[]> {
  const api = OpenCode.make({
    baseUrl: opencodeAddress(agent.endpoint),
    headers: opencodeHeaders(agent.env),
  })
  const inventory = await api.experimental.job.list(
    { sessionID: sessionId, descendants: true },
    { signal: AbortSignal.timeout(5000) },
  )
  const owned = ownedJobSessions(inventory, sessionId)
  const info = inventory.find((job) => `job:${job.id}` === id && owned.has(job.sessionID))
  if (!info || info.kind === 'subagent')
    throw new Error('This job does not belong to the OpenCode session.')
  if (info.kind === 'shell') {
    const output = await api.shell.output(
      { id: info.shellID, location: { directory: cwd }, cursor: 0, limit: 64000 },
      { signal: AbortSignal.timeout(5000) },
    )
    const tail =
      output.data.size > output.data.cursor
        ? await api.shell.output(
            {
              id: info.shellID,
              location: { directory: cwd },
              cursor: Math.max(0, output.data.size - 64000),
              limit: 64000,
            },
            { signal: AbortSignal.timeout(5000) },
          )
        : output
    return [
      {
        id,
        role: 'tool',
        label: info.command,
        text: `${tail.data.output.slice(-64000)}\nStatus: ${info.status}`,
      },
    ]
  }
  const entry: NativeThreadEntry = {
    id,
    role: 'tool',
    label: 'Image generation',
    text: `${info.status}. Output: ${info.path}`,
  }
  if (info.status !== 'completed') return [entry]
  const url = new URL(
    `${opencodeAddress(agent.endpoint)}/api/fs/read/${info.path.split('/').map(encodeURIComponent).join('/')}`,
  )
  url.searchParams.set('location', JSON.stringify({ directory: cwd }))
  const response = await fetch(url, {
    headers: opencodeHeaders(agent.env),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  })
  if (!response.ok || !response.body)
    throw new Error(`OpenCode image preview failed (${response.status}).`)
  const limit = 8 * 1024 * 1024
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > limit)
        return [
          {
            ...entry,
            text: `${entry.text}\nPreview exceeds the 8 MB limit. Open the output file to view it.`,
          },
        ]
      chunks.push(part.value)
    }
  } finally {
    await reader.cancel()
  }
  // Decode only bounded raster images, never HTML/SVG returned by a file path.
  const image = sharp(Buffer.concat(chunks), { limitInputPixels: 32_000_000 })
  const metadata = await image.metadata()
  if (!['png', 'jpeg', 'webp', 'avif', 'gif'].includes(metadata.format ?? ''))
    throw new Error('This job output is not a supported raster image.')
  const data = await image
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer()
  if (data.byteLength > 1024 * 1024)
    return [
      { ...entry, text: `${entry.text}\nPreview is too large. Open the output file to view it.` },
    ]
  return [{ ...entry, image: { mime: 'image/webp', data: data.toString('base64') } }]
}

export function ownedJobSessions(inventory: readonly JobInfo[], root: string) {
  const owned = new Set([root])
  for (let round = 0; round < inventory.length; round++) {
    const before = owned.size
    for (const job of inventory)
      if (job.kind === 'subagent' && owned.has(job.sessionID)) owned.add(job.childSessionID)
    if (owned.size === before) break
  }
  return owned
}
