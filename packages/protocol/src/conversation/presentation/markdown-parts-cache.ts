type CachedPart = { offset: number } & Record<string, unknown>
/** Cached parts are shared by every mount; nested values such as templates are read-only too. */
export type ImmutableMarkdownParts<Part> = readonly Immutable<Part>[]
type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T

// A generic Part cannot resolve Immutable<Part>; read-only typing keeps the same object shape.
function immutable<Part>(parts: readonly Part[]) {
  return parts as unknown as ImmutableMarkdownParts<Part>
}
function freeze(value: unknown) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const child of Object.values(value)) freeze(child)
  Object.freeze(value)
}

/** Estimated retained bytes: UTF-16 source plus each part's strings and object overhead. */
function partsSize(text: string, parts: readonly CachedPart[]) {
  let size = 64 + text.length * 2
  for (const part of parts) {
    size += 64
    for (const value of Object.values(part))
      if (typeof value === 'string') size += 16 + value.length * 2
      else if (value && typeof value === 'object') size += 64 + JSON.stringify(value).length * 2
  }
  return size
}

/**
 * Reuse completed Markdown preprocessing across remounts. Cached results are shared and frozen.
 * Streaming prefixes and entries above a quarter of the budget are never retained.
 */
export function cachedMarkdownParts<Part extends CachedPart>(
  split: (text: string, localFiles: boolean) => readonly Part[],
  { budget = 2 * 1024 * 1024, limit = 256 } = {},
) {
  // Keyed by the caller's own string, so the cache adds no second copy of the source text.
  const entries = new Map<
    string,
    { localFiles: boolean; parts: ImmutableMarkdownParts<Part>; bytes: number }
  >()
  let bytes = 0
  const remove = (text: string) => {
    const entry = entries.get(text)
    if (!entry) return
    entries.delete(text)
    bytes -= entry.bytes
  }
  return (text: string, localFiles: boolean, streaming = false): ImmutableMarkdownParts<Part> => {
    if (streaming) return immutable(split(text, localFiles))
    const cached = entries.get(text)
    if (cached?.localFiles === localFiles) {
      entries.delete(text)
      entries.set(text, cached)
      return cached.parts
    }
    remove(text)
    const parts = split(text, localFiles)
    const size = partsSize(text, parts)
    if (size > budget / 4) return immutable(parts)
    while (bytes + size > budget || entries.size >= limit) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      remove(oldest)
    }
    // Freeze only shared entries; streaming and oversized results stay private to their caller.
    freeze(parts)
    entries.set(text, { localFiles, parts: immutable(parts), bytes: size })
    bytes += size
    return immutable(parts)
  }
}
