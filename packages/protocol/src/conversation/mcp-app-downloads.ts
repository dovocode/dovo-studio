const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : {}
export type McpAppDownload = { name: string; mime: string; text?: string; blob?: string }
export async function mcpAppDownloads(
  params: unknown,
  read: (uri: string) => Promise<unknown>,
): Promise<McpAppDownload[]> {
  const contents = object(params).contents
  if (!Array.isArray(contents) || !contents.length || contents.length > 8)
    throw new Error('An app can export one to eight files')
  const resources: unknown[] = []
  for (const item of contents) {
    const entry = object(item)
    if (entry.type === 'resource') resources.push(entry.resource)
    else if (entry.type === 'resource_link' && typeof entry.uri === 'string') {
      const result = object(await read(entry.uri))
      if (!Array.isArray(result.contents)) throw new Error('The exported resource is unavailable')
      resources.push(...result.contents)
    } else throw new Error('Unsupported app export')
  }
  if (resources.length > 8) throw new Error('Too many app exports')
  let size = 0
  return resources.map((value) => {
    const resource = object(value),
      text = resource.text,
      blob = resource.blob
    if (typeof text !== 'string' && typeof blob !== 'string')
      throw new Error('The exported file is empty')
    size += typeof text === 'string' ? text.length : typeof blob === 'string' ? blob.length : 0
    if (size > 2 * 1024 * 1024) throw new Error('App exports exceed the two megabyte limit')
    if (typeof blob === 'string' && !/^[a-zA-Z0-9+/]*={0,2}$/.test(blob))
      throw new Error('Invalid exported file encoding')
    const name =
      (typeof resource.uri === 'string'
        ? resource.uri.split('/').at(-1)?.split(/[?#]/)[0]
        : undefined
      )
        ?.replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/^\.+/, '')
        .slice(0, 120) || 'export.txt'
    const mime =
      typeof resource.mimeType === 'string' &&
      /^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(resource.mimeType)
        ? resource.mimeType
        : 'application/octet-stream'
    return {
      name,
      mime,
      ...(typeof text === 'string'
        ? { text }
        : { blob: typeof blob === 'string' ? blob : undefined }),
    }
  })
}
