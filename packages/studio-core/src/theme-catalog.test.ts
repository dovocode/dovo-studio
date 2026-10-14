import { expect, it } from 'vite-plus/test'
import { strToU8, zipSync } from 'fflate'
import { sha256 } from '@noble/hashes/sha2.js'
import { decodeResult } from '@dovo/protocol'
import { addImportedCodeTheme, importedCodeThemesSchema, nativeCodeColors } from './code-themes'
import {
  loadCodeThemeExtension,
  readThemePackage,
  searchCodeThemes,
  themeCatalogUrl,
} from './theme-catalog'

const extension = { namespace: 'example', name: 'theme', version: '1.2.3', displayName: 'Example' }
const signal = () => new AbortController().signal
const colors = { 'editor.background': '#101010', 'editor.foreground': '#dddddd' }
const contribution = { label: 'Example Dark', path: './themes/dark.json', uiTheme: 'vs-dark' }
function archive(files: Record<string, string>, themes: object[] = [contribution]) {
  return zipSync(
    Object.fromEntries(
      Object.entries({
        'extension/package.json': JSON.stringify({ contributes: { themes } }),
        ...files,
      }).map(([path, value]) => [path, strToU8(value)]),
    ),
  )
}
const packageBytes = () => archive({ 'extension/themes/dark.json': JSON.stringify({ colors }) })

it('searches only themes, preserves pagination and uses popular ordering for an empty query', async () => {
  const urls: URL[] = []
  const fetcher: typeof fetch = async (input, options) => {
    urls.push(new URL(input instanceof Request ? input.url : input.toString()))
    expect(options?.credentials).toBe('omit')
    expect(options?.signal).toBeDefined()
    return Response.json({ extensions: [extension], totalSize: 21, offset: 20 })
  }
  expect((await searchCodeThemes('  Example  ', 20, signal(), fetcher)).extensions).toEqual([
    extension,
  ])
  expect(urls[0].searchParams.get('query')).toBe('Example')
  expect(urls[0].searchParams.get('offset')).toBe('20')
  expect(urls[0].searchParams.get('category')).toBe('Themes')
  expect(urls[0].searchParams.has('sortBy')).toBe(false)
  await searchCodeThemes('', 0, signal(), fetcher)
  expect(urls[1].searchParams.get('sortBy')).toBe('downloadCount')
  expect(themeCatalogUrl(extension)).toBe('https://open-vsx.org/extension/example/theme')
})

it('merges relative JSONC includes in order, preserving variant labels, declared modes and provenance', () => {
  const bytes = archive(
    {
      'extension/base.json': JSON.stringify({
        name: 'Duplicate',
        type: 'light',
        colors,
        tokenColors: [
          { settings: { foreground: '#111111' } },
          { scope: 'keyword', settings: { foreground: '#abcdef' } },
        ],
      }),
      'extension/themes/dark.json': `{// comment\n"include":"../base.json", "tokenColors":[{"settings":{"foreground":"#eeeeee"}},{"scope":"keyword","settings":{"foreground":"#fedcba"}}],}`,
      'extension/themes/light.json':
        '{"include":"../base.json","colors":{"editor.background":"#ffffff"}}',
    },
    [
      contribution,
      { ...contribution, label: 'Example Light', path: './themes/light.json', uiTheme: 'hc-light' },
    ],
  )
  const bundle = readThemePackage(bytes, extension, 'MIT')
  expect(bundle.warnings).toEqual([])
  expect(bundle.themes.map((theme) => [theme.label, theme.type])).toEqual([
    ['Example Dark', 'dark'],
    ['Example Light', 'light'],
  ])
  expect(nativeCodeColors(bundle.themes[0]).keyword).toBe('#fedcba')
  expect(bundle.themes[0].bg).toBe('#101010')
  expect(bundle.themes[0].source).toEqual({
    registry: 'open-vsx',
    publisher: 'example',
    extension: 'theme',
    version: '1.2.3',
    license: 'MIT',
  })
  expect(decodeResult(importedCodeThemesSchema, bundle.themes).success).toBe(true)
  expect(addImportedCodeTheme(bundle.themes, bundle.themes[0])).toHaveLength(2)
})

it('allows valid siblings while reporting cycles, escaped paths, missing files and legacy themes', () => {
  const broken = [
    { ...contribution, label: 'Cycle', path: './cycle.json' },
    { ...contribution, label: 'Escaped', path: '../outside.json' },
    { ...contribution, label: 'Missing', path: './missing.json' },
    { ...contribution, label: 'Legacy', path: './legacy.tmTheme' },
  ]
  const bundle = readThemePackage(
    archive(
      {
        'extension/themes/dark.json': JSON.stringify({ colors }),
        'extension/cycle.json': '{"include":"cycle.json"}',
        'extension/executable.js': 'throw new Error("Must never execute")',
      },
      [contribution, ...broken],
    ),
    extension,
  )
  expect(bundle.themes).toHaveLength(1)
  expect(bundle.warnings.join('\n')).toContain('cyclic')
  expect(bundle.warnings.join('\n')).toContain('outside its extension')
  expect(bundle.warnings.join('\n')).toContain('Missing theme file')
  expect(bundle.warnings.join('\n')).toContain('exported as JSON')
})

it('rejects oversized files before extracting and distinguishes icon-only packages', () => {
  expect(() =>
    readThemePackage(
      archive({ 'extension/themes/dark.json': ' '.repeat(1024 * 1024 + 1) }),
      extension,
    ),
  ).toThrow('exceeds 1 MB')
  expect(() => readThemePackage(archive({}, []), extension)).toThrow('no code color themes')
  expect(() => readThemePackage(new Uint8Array(32 * 1024 * 1024 + 1), extension)).toThrow(
    'smaller than 32 MB',
  )
})

function downloadFetcher(options: { checksum?: string; version?: string; source?: string } = {}) {
  const bytes = packageBytes()
  const hex = Array.from(sha256(bytes), (value) => value.toString(16).padStart(2, '0')).join('')
  const urls: string[] = []
  const path = 'https://open-vsx.org/api/example/theme/1.2.3'
  const fetcher: typeof fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString()
    urls.push(url)
    if (url === path)
      return Response.json({
        ...extension,
        version: options.version ?? extension.version,
        license: 'MIT',
        files: {
          download: options.source ?? path + '/file/theme.vsix',
          sha256: path + '/file/theme.sha256',
        },
      })
    if (url.endsWith('.sha256')) return new Response(options.checksum ?? hex + '  theme.vsix\n')
    return new Response(new Uint8Array(bytes).buffer)
  }
  return { fetcher, urls }
}

it('downloads the exact searched version and validates the registry checksum before importing', async () => {
  const { fetcher, urls } = downloadFetcher()
  const bundle = await loadCodeThemeExtension(extension, signal(), fetcher)
  expect(bundle.themes[0].source?.version).toBe('1.2.3')
  expect(urls[0]).toBe('https://open-vsx.org/api/example/theme/1.2.3')
  await expect(
    loadCodeThemeExtension(extension, signal(), downloadFetcher({ checksum: '0000' }).fetcher),
  ).rejects.toThrow('checksum')
  await expect(
    loadCodeThemeExtension(extension, signal(), downloadFetcher({ version: '2.0.0' }).fetcher),
  ).rejects.toThrow('different extension version')
  const unexpected = downloadFetcher({ source: 'https://example.org/malicious.vsix' })
  await expect(loadCodeThemeExtension(extension, signal(), unexpected.fetcher)).rejects.toThrow(
    'unexpected package source',
  )
  expect(unexpected.urls).toHaveLength(1)
})

it('reports registry failures and malformed results without changing preferences', async () => {
  await expect(
    searchCodeThemes('', 0, signal(), async () => new Response('', { status: 503 })),
  ).rejects.toThrow('503')
  await expect(
    searchCodeThemes('', 0, signal(), async () =>
      Response.json({
        extensions: [{ ...extension, namespace: '../bad' }],
        totalSize: 1,
        offset: 0,
      }),
    ),
  ).rejects.toThrow('invalid theme catalog')
  await expect(
    searchCodeThemes(
      '',
      0,
      signal(),
      async () => new Response('', { headers: { 'content-length': String(1024 * 1024 + 1) } }),
    ),
  ).rejects.toThrow('too large')
})

it('propagates cancellation to the download', async () => {
  const controller = new AbortController()
  const fetcher: typeof fetch = async (_input, options) =>
    new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  const pending = searchCodeThemes('', 0, controller.signal, fetcher)
  controller.abort()
  await expect(pending).rejects.toThrow('aborted')
})
