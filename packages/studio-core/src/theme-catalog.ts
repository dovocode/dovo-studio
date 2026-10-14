import { Schema } from 'effect'
import { sha256 } from '@noble/hashes/sha2.js'
import { strFromU8, unzipSync } from 'fflate'
import { decodeResult, mutableArray, mutableStruct } from '@dovo/protocol'
import { useEffect, useState } from 'react'
import {
  importCodeTheme,
  maxCodeThemeBytes,
  parseCodeThemeSource,
  type ImportedCodeTheme,
} from './code-themes'

const registry = 'https://open-vsx.org'
const text = Schema.String.pipe(Schema.check(Schema.isMaxLength(4096)))
const identifier = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value) => /^[\w-]{1,128}$/.test(value))),
)
const version = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value) => /^[\w.+-]{1,128}$/.test(value))),
)
const extensionSchema = mutableStruct({
  namespace: identifier,
  name: identifier,
  version,
  displayName: Schema.optional(text),
  description: Schema.optional(text),
  downloadCount: Schema.optional(Schema.Number),
  verified: Schema.optional(Schema.Boolean),
})
const pageSchema = mutableStruct({
  extensions: mutableArray(extensionSchema),
  totalSize: Schema.Number,
  offset: Schema.Number,
})
const detailSchema = mutableStruct({
  namespace: identifier,
  name: identifier,
  version,
  license: Schema.optional(text),
  files: mutableStruct({ download: text, sha256: text }),
})
const manifestSchema = mutableStruct({
  contributes: Schema.optional(
    mutableStruct({
      themes: Schema.optional(
        mutableArray(
          mutableStruct({
            label: Schema.optional(text),
            id: Schema.optional(text),
            path: text,
            uiTheme: Schema.Literals(['vs', 'vs-dark', 'hc-black', 'hc-light']),
          }),
        ).pipe(Schema.check(Schema.isMaxLength(128))),
      ),
    }),
  ),
})
export type ThemeCatalogExtension = Schema.Schema.Type<typeof extensionSchema>
export type ThemeCatalogPage = Schema.Schema.Type<typeof pageSchema>
export type ThemeCatalogBundle = { themes: ImportedCodeTheme[]; warnings: string[] }

export function themeCatalogUrl(extension: ThemeCatalogExtension) {
  return `${registry}/extension/${encodeURIComponent(extension.namespace)}/${encodeURIComponent(extension.name)}`
}
function extensionPath(extension: ThemeCatalogExtension) {
  return `/api/${encodeURIComponent(extension.namespace)}/${encodeURIComponent(extension.name)}/${encodeURIComponent(extension.version)}`
}
function packageUrl(url: string, extension: ThemeCatalogExtension) {
  const parsed = new URL(url)
  if (
    parsed.origin !== registry ||
    !parsed.pathname.startsWith(`${extensionPath(extension)}/file/`) ||
    parsed.username ||
    parsed.password
  )
    throw new Error('The registry returned an unexpected package source.')
  return parsed.toString()
}
async function readBytes(url: string, maximum: number, signal: AbortSignal, fetcher: typeof fetch) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    abort()
  }, 30_000)
  try {
    const response = await fetcher(url, { signal: controller.signal, credentials: 'omit' })
    if (!response.ok) throw new Error(`Open VSX request failed (${response.status}). Try again.`)
    if (Number(response.headers.get('content-length')) > maximum)
      throw new Error('This registry response is too large to import.')
    // Browser/Expo streaming keeps downloads bounded. Older native fetch falls back to a buffer.
    if (!response.body?.getReader) {
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > maximum)
        throw new Error('This registry response is too large to import.')
      return bytes
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximum) {
        await reader.cancel()
        throw new Error('This registry response is too large to import.')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } catch (cause) {
    if (timedOut)
      throw new Error('Open VSX took too long to respond. Check your connection and try again.')
    throw cause
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    controller.abort()
  }
}

export async function searchCodeThemes(
  query: string,
  offset: number,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ThemeCatalogPage> {
  const url = new URL('/api/-/search', registry)
  url.search = new URLSearchParams({
    query: query.trim().slice(0, 200),
    category: 'Themes',
    size: '20',
    offset: String(offset),
    ...(query.trim() ? {} : { sortBy: 'downloadCount', sortOrder: 'desc' }),
  }).toString()
  const bytes = await readBytes(url.toString(), 1024 * 1024, signal, fetcher)
  const data: unknown = JSON.parse(strFromU8(bytes))
  const result = decodeResult(pageSchema, data)
  if (!result.success) throw new Error('Open VSX returned an invalid theme catalog.')
  return result.data
}

function themePath(path: string, parent = 'extension/package.json') {
  if (/^[\\/]|:/.test(path) || path.includes(String.fromCharCode(0)))
    throw new Error('This theme references a file outside its extension.')
  const parts = parent.split('/').slice(0, -1)
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length <= 1) throw new Error('This theme references a file outside its extension.')
      parts.pop()
    } else parts.push(part)
  }
  return parts.join('/')
}

/** Only theme JSON and the manifest are decoded; no extension entry point is installed or run. */
export function readThemePackage(
  bytes: Uint8Array,
  extension: ThemeCatalogExtension,
  license?: string,
): ThemeCatalogBundle {
  if (bytes.byteLength > 32 * 1024 * 1024)
    throw new Error('Choose a theme package smaller than 32 MB.')
  const files = new Map<string, string>()
  let total = 0
  const read = (path: string) => {
    const cached = files.get(path)
    if (cached !== undefined) return cached
    let tooLarge = false
    const extracted = unzipSync(bytes, {
      filter: (entry) => {
        if (entry.name !== path) return false
        if (entry.originalSize > maxCodeThemeBytes) {
          tooLarge = true
          return false
        }
        return true
      },
    })[path]
    if (tooLarge) throw new Error(`Theme file exceeds 1 MB: ${path}`)
    if (!extracted) throw new Error(`Missing theme file: ${path}`)
    total += extracted.byteLength
    if (total > 8 * 1024 * 1024)
      throw new Error('This package contains too much theme data to import.')
    const contents = strFromU8(extracted)
    files.set(path, contents)
    return contents
  }
  const manifest: unknown = JSON.parse(read('extension/package.json'))
  const decoded = decodeResult(manifestSchema, manifest)
  if (!decoded.success) throw new Error('The extension has an invalid theme manifest.')
  const contributed = decoded.data.contributes?.themes ?? []
  if (!contributed.length)
    throw new Error('This extension contains icon themes, but no code color themes.')
  type ThemeSource = ReturnType<typeof parseCodeThemeSource>
  const resolve = (path: string, parents: readonly string[] = []): ThemeSource => {
    if (parents.includes(path) || parents.length >= 16)
      throw new Error('This theme has cyclic or excessively nested includes.')
    const source = parseCodeThemeSource(read(path))
    const { include, ...own } = source
    if (include === undefined) return own
    const base = resolve(themePath(include, path), [...parents, path])
    return {
      ...base,
      ...own,
      colors: { ...base.colors, ...own.colors },
      tokenColors: [...(base.tokenColors ?? []), ...(own.tokenColors ?? [])],
    }
  }
  const themes: ImportedCodeTheme[] = []
  const warnings: string[] = []
  for (const contributedTheme of contributed) {
    const label = (
      contributedTheme.label ??
      contributedTheme.id ??
      extension.displayName ??
      extension.name
    ).slice(0, 256)
    try {
      const path = themePath(contributedTheme.path)
      if (!/\.jsonc?$/i.test(path))
        throw new Error('Legacy plist themes need to be exported as JSON from VS Code.')
      const source = resolve(path)
      const type =
        contributedTheme.uiTheme === 'vs' || contributedTheme.uiTheme === 'hc-light'
          ? 'light'
          : 'dark'
      const theme = importCodeTheme(JSON.stringify({ ...source, name: label, type }), path)
      themes.push({
        ...theme,
        source: {
          registry: 'open-vsx',
          publisher: extension.namespace,
          extension: extension.name,
          version: extension.version,
          ...(license ? { license: license.slice(0, 256) } : {}),
        },
      })
    } catch (cause) {
      warnings.push(`${label}: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  if (!themes.length) throw new Error(warnings[0] ?? 'This package has no usable code themes.')
  return { themes: [...new Map(themes.map((theme) => [theme.name, theme])).values()], warnings }
}

export async function loadCodeThemeExtension(
  extension: ThemeCatalogExtension,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ThemeCatalogBundle> {
  const bytes = await readBytes(
    `${registry}${extensionPath(extension)}`,
    1024 * 1024,
    signal,
    fetcher,
  )
  const data: unknown = JSON.parse(strFromU8(bytes))
  const result = decodeResult(detailSchema, data)
  if (
    !result.success ||
    result.data.namespace !== extension.namespace ||
    result.data.name !== extension.name ||
    result.data.version !== extension.version
  )
    throw new Error('The registry returned a different extension version. Search again.')
  const metadata = result.data
  const [archive, checksum] = await Promise.all([
    readBytes(packageUrl(metadata.files.download, extension), 32 * 1024 * 1024, signal, fetcher),
    readBytes(packageUrl(metadata.files.sha256, extension), 4096, signal, fetcher),
  ])
  if (signal.aborted) throw new Error('Theme download canceled.')
  const actual = Array.from(sha256(archive), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const expected = strFromU8(checksum).trim().split(/\s+/)[0].toLowerCase()
  if (actual !== expected)
    throw new Error('The theme package failed its checksum check. Try again.')
  return readThemePackage(archive, extension, metadata.license)
}

/** Shared request lifecycle for desktop and native browsers; edits remain device-local. */
export function useCodeThemeCatalog() {
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [attempt, retry] = useState(0)
  const [page, setPage] = useState<ThemeCatalogPage>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, select] = useState<ThemeCatalogExtension>()
  const [bundle, setBundle] = useState<ThemeCatalogBundle>()
  const [bundleError, setBundleError] = useState('')
  const [bundleAttempt, retryBundle] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError('')
    const timer = setTimeout(
      () => {
        void searchCodeThemes(query, offset, controller.signal).then(
          (result) => {
            if (!active) return
            setPage((previous) => ({
              ...result,
              extensions:
                offset && previous
                  ? [
                      ...new Map(
                        [...previous.extensions, ...result.extensions].map((extension) => [
                          `${extension.namespace}.${extension.name}`,
                          extension,
                        ]),
                      ).values(),
                    ]
                  : result.extensions,
            }))
            setLoading(false)
          },
          (cause) => {
            if (active) {
              setError(cause instanceof Error ? cause.message : String(cause))
              setLoading(false)
            }
          },
        )
      },
      query ? 300 : 0,
    )
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, offset, attempt])
  useEffect(() => {
    setBundle(undefined)
    setBundleError('')
    if (!selected) return
    const controller = new AbortController()
    let active = true
    void loadCodeThemeExtension(selected, controller.signal).then(
      (result) => {
        if (active) setBundle(result)
      },
      (cause) => {
        if (active) setBundleError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => {
      active = false
      controller.abort()
    }
  }, [selected, bundleAttempt])
  return {
    query,
    setQuery: (value: string) => {
      if (value === query) return
      setQuery(value)
      setOffset(0)
      setPage(undefined)
    },
    page,
    loading,
    error,
    retry: () => retry((value) => value + 1),
    more: () => {
      if (!loading && !error && page) setOffset(page.offset + 20)
    },
    selected,
    select: (extension?: ThemeCatalogExtension) => {
      setBundle(undefined)
      setBundleError('')
      select(extension)
    },
    bundle,
    bundleError,
    retryBundle: () => retryBundle((value) => value + 1),
  }
}
